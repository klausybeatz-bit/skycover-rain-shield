/**
 * Server-only TinyFish client.
 *
 * Two endpoints are wrapped, both with the same guarantees:
 *   - the API key is sent as an `X-API-Key` header and never logged or returned;
 *   - every call has a hard timeout, so a slow upstream cannot hang a page;
 *   - retryable failures (timeouts, network errors, 429s, 5xx) are retried a
 *     bounded number of times with exponential backoff;
 *   - requests are counted against a per-minute budget before they leave, so
 *     SkyCover throttles itself instead of being throttled;
 *   - every failure is normalised into a TinyFishError with a message that is
 *     safe to show a user.
 *
 * This module must only be imported from server code paths.
 */

import { describeApiKeyShape, getTinyFishConfig, type ApiKeyDiagnostics } from "./config";
import {
  TinyFishError,
  type TinyFetchParams,
  type TinyFetchResponse,
  type TinyFishFailureKind,
  type TinySearchParams,
  type TinySearchResponse,
} from "./types";

export const TINY_SEARCH_ENDPOINT = "https://api.search.tinyfish.ai";
export const TINY_FETCH_ENDPOINT = "https://api.fetch.tinyfish.ai";

const TINY_SEARCH_HOST = "api.search.tinyfish.ai";
const TINY_FETCH_HOST = "api.fetch.tinyfish.ai";

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 300;
/** Hard ceilings so no parameter can turn a request into an unbounded one. */
const MAX_FETCH_URLS = 10;

export interface TinyFishCallOptions {
  timeoutMs?: number;
  /** Total attempts, including the first. */
  attempts?: number;
  /** Injected for tests; defaults to the runtime fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

/** Timestamps of recent TinyFish requests, newest last. Per isolate. */
const requestLog: number[] = [];
const RATE_WINDOW_MS = 60_000;

/** Clear the limiter state. Used by tests. */
export function resetRateLimiter(): void {
  requestLog.length = 0;
}

function assertWithinRateLimit(limit: number, now: number): void {
  while (requestLog.length > 0 && now - requestLog[0]! >= RATE_WINDOW_MS) requestLog.shift();
  if (requestLog.length >= limit) {
    throw new TinyFishError(
      "quota",
      `SkyCover self-throttled: ${limit} live-data requests per minute is this server's budget.`,
      { retryable: false },
    );
  }
  requestLog.push(now);
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

function classifyStatus(status: number): TinyFishFailureKind {
  if (status === 400 || status === 422) return "bad_request";
  if (status === 401) return "auth";
  if (status === 402) return "quota";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "quota";
  if (status >= 500) return "upstream";
  return "upstream";
}

interface RawResponse {
  status: number;
  body: unknown;
}

async function requestJson(
  url: string,
  init: RequestInit,
  options: Required<Pick<TinyFishCallOptions, "timeoutMs" | "fetchImpl">>,
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  let response: Response;
  try {
    response = await options.fetchImpl(url, { ...init, signal: controller.signal });
  } catch (cause) {
    if (controller.signal.aborted) {
      throw new TinyFishError(
        "timeout",
        `The live data service did not respond within ${options.timeoutMs} ms.`,
        {
          retryable: true,
          cause,
        },
      );
    }
    throw new TinyFishError("network", "The live data service could not be reached.", {
      retryable: true,
      cause,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text().catch(() => "");
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch (cause) {
      if (response.ok) {
        throw new TinyFishError(
          "invalid_response",
          "The live data service returned a non-JSON body.",
          {
            status: response.status,
            cause,
          },
        );
      }
    }
  }

  if (!response.ok) {
    // The upstream body is deliberately not forwarded: it is untrusted text and
    // could echo request details back into our logs.
    throw new TinyFishError(
      classifyStatus(response.status),
      `The live data service responded with HTTP ${response.status}.`,
      { status: response.status },
    );
  }

  return { status: response.status, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(runAttempt: () => Promise<T>, attempts: number): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await runAttempt();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TinyFishError && error.retryable;
      if (!retryable || attempt === attempts - 1) throw error;
      await sleep(BACKOFF_BASE_MS * 2 ** attempt);
    }
  }
  throw lastError;
}

function resolveOptions(options: TinyFishCallOptions): {
  timeoutMs: number;
  attempts: number;
  fetchImpl: typeof fetch;
  now: number;
} {
  return {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    attempts: Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS),
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ? options.now() : Date.now(),
  };
}

function requireApiKey(): string {
  const config = getTinyFishConfig();
  if (!config.apiKey) {
    throw new TinyFishError(
      "unconfigured",
      "Live data is not configured on this server: TINYFISH_API_KEY is not set.",
      { retryable: false },
    );
  }
  return config.apiKey;
}

function isStringRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Failure diagnostics
// ---------------------------------------------------------------------------

/**
 * A single, safe record written to the platform log when a TinyFish call
 * fails. It carries exactly what a diagnosis needs — the failure category, the
 * upstream HTTP status when there was one, the timeout, the attempt count and
 * the *shape* of the credential — and nothing that could leak a secret: no API
 * key, no authorization header, no request URL or body.
 */
interface TinyFishFailureRecord {
  event: "tinyfish.request.failed";
  host: string;
  kind: string;
  status: number | null;
  timeoutMs: number;
  attempts: number;
  durationMs: number;
  /** The cause's error *type* only, e.g. "TypeError" — never its message. */
  causeName: string | null;
  key: ApiKeyDiagnostics;
}

function failureOf(error: unknown): {
  kind: string;
  status: number | null;
  causeName: string | null;
} {
  if (error instanceof TinyFishError) {
    return {
      kind: error.kind,
      status: error.status,
      causeName: error.cause instanceof Error ? error.cause.name : null,
    };
  }
  return {
    kind: "unexpected",
    status: null,
    causeName: error instanceof Error ? error.name : null,
  };
}

function reportFailure(record: TinyFishFailureRecord): void {
  // console.error is the channel Cloudflare Workers capture as a log event.
  console.error("[tinyfish]", JSON.stringify(record));
}

// ---------------------------------------------------------------------------
// TinySearch
// ---------------------------------------------------------------------------

export async function tinySearch(
  params: TinySearchParams,
  options: TinyFishCallOptions = {},
): Promise<TinySearchResponse> {
  const { timeoutMs, attempts, fetchImpl, now } = resolveOptions(options);
  const limit = getTinyFishConfig().rateLimitPerMinute;
  const startedAt = Date.now();

  try {
    const apiKey = requireApiKey();

    const url = new URL(TINY_SEARCH_ENDPOINT);
    url.searchParams.set("query", params.query);
    if (params.purpose) url.searchParams.set("purpose", params.purpose.slice(0, 2000));
    if (params.location) url.searchParams.set("location", params.location);
    if (params.language) url.searchParams.set("language", params.language);
    if (params.includeDomains) url.searchParams.set("include_domains", params.includeDomains);
    if (params.excludeDomains) url.searchParams.set("exclude_domains", params.excludeDomains);
    if (params.recencyMinutes !== undefined) {
      url.searchParams.set("recency_minutes", String(Math.floor(params.recencyMinutes)));
    }
    if (params.afterDate) url.searchParams.set("after_date", params.afterDate);
    if (params.beforeDate) url.searchParams.set("before_date", params.beforeDate);
    if (params.domainType) url.searchParams.set("domain_type", params.domainType);
    if (params.page !== undefined) url.searchParams.set("page", String(Math.floor(params.page)));

    const { body } = await withRetry(async () => {
      assertWithinRateLimit(limit, now);
      return requestJson(
        url.toString(),
        {
          method: "GET",
          headers: { "X-API-Key": apiKey, accept: "application/json" },
        },
        { timeoutMs, fetchImpl },
      );
    }, attempts);

    if (!isStringRecord(body) || !Array.isArray(body["results"])) {
      throw new TinyFishError("invalid_response", "TinySearch returned an unexpected payload.", {});
    }

    return {
      query: typeof body["query"] === "string" ? body["query"] : params.query,
      results: body["results"] as TinySearchResponse["results"],
      total_results: typeof body["total_results"] === "number" ? body["total_results"] : 0,
      page: typeof body["page"] === "number" ? body["page"] : 0,
    };
  } catch (error) {
    reportFailure({
      event: "tinyfish.request.failed",
      host: TINY_SEARCH_HOST,
      timeoutMs,
      attempts,
      durationMs: Date.now() - startedAt,
      key: describeApiKeyShape(getTinyFishConfig().apiKey),
      ...failureOf(error),
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// TinyFetch
// ---------------------------------------------------------------------------

export async function tinyFetch(
  params: TinyFetchParams,
  options: TinyFishCallOptions = {},
): Promise<TinyFetchResponse> {
  const { timeoutMs, attempts, fetchImpl, now } = resolveOptions(options);
  const limit = getTinyFishConfig().rateLimitPerMinute;
  const startedAt = Date.now();

  try {
    const apiKey = requireApiKey();

    const urls = params.urls.filter((url) => /^https?:\/\//i.test(url)).slice(0, MAX_FETCH_URLS);
    if (urls.length === 0) {
      throw new TinyFishError("bad_request", "TinyFetch needs at least one http(s) URL.", {
        retryable: false,
      });
    }

    const payload: Record<string, unknown> = {
      urls,
      format: params.format ?? "markdown",
    };
    if (params.purpose) payload["purpose"] = params.purpose.slice(0, 2000);
    if (params.includeSelectors?.length)
      payload["include_selectors"] = params.includeSelectors.slice(0, 20);
    if (params.excludeSelectors?.length)
      payload["exclude_selectors"] = params.excludeSelectors.slice(0, 20);
    if (params.ttl !== undefined) payload["ttl"] = params.ttl;
    if (params.perUrlTimeoutMs !== undefined)
      payload["per_url_timeout_ms"] = params.perUrlTimeoutMs;

    const { body } = await withRetry(async () => {
      assertWithinRateLimit(limit, now);
      return requestJson(
        TINY_FETCH_ENDPOINT,
        {
          method: "POST",
          headers: {
            "X-API-Key": apiKey,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(payload),
        },
        { timeoutMs, fetchImpl },
      );
    }, attempts);

    if (!isStringRecord(body) || !Array.isArray(body["results"])) {
      throw new TinyFishError("invalid_response", "TinyFetch returned an unexpected payload.", {});
    }

    return {
      results: body["results"] as TinyFetchResponse["results"],
      errors: Array.isArray(body["errors"]) ? (body["errors"] as TinyFetchResponse["errors"]) : [],
    };
  } catch (error) {
    reportFailure({
      event: "tinyfish.request.failed",
      host: TINY_FETCH_HOST,
      timeoutMs,
      attempts,
      durationMs: Date.now() - startedAt,
      key: describeApiKeyShape(getTinyFishConfig().apiKey),
      ...failureOf(error),
    });
    throw error;
  }
}
