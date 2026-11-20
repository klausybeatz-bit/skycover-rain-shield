/**
 * TinyFish API contracts.
 *
 * Shapes are transcribed from the published reference:
 *   Search -> https://docs.tinyfish.ai/search-api/reference
 *   Fetch  -> https://docs.tinyfish.ai/fetch-api/reference
 *
 * Nothing in this file is secret or location-specific; it is safe to import
 * from anywhere. The API key lives only in ./config.ts.
 */

// ---------------------------------------------------------------------------
// TinySearch — GET https://api.search.tinyfish.ai
// ---------------------------------------------------------------------------

export type TinySearchDomainType = "web" | "news" | "research_paper";

export interface TinySearchParams {
  /** The search query. Required. */
  query: string;
  /** Why we are searching. Feeds ranking quality; max 2000 chars. */
  purpose?: string;
  /** Country code for geo-targeting (e.g. "IN"). Defaults to US. */
  location?: string;
  /** Result language (e.g. "en"). Defaults to en. */
  language?: string;
  /** Comma-separated allow-list of domains. */
  includeDomains?: string;
  /** Comma-separated deny-list of domains. */
  excludeDomains?: string;
  /** Freshness window in minutes (1 .. 5256000). Mutually exclusive with dates. */
  recencyMinutes?: number;
  /** Lower date bound, YYYY-MM-DD. */
  afterDate?: string;
  /** Upper date bound, YYYY-MM-DD. */
  beforeDate?: string;
  domainType?: TinySearchDomainType;
  /** Page number, 0-indexed, max 10. */
  page?: number;
}

export interface TinySearchResult {
  position: number;
  site_name: string;
  title: string;
  snippet: string;
  url: string;
  date?: string;
  publisher?: string;
}

export interface TinySearchResponse {
  query: string;
  results: TinySearchResult[];
  total_results: number;
  page: number;
}

// ---------------------------------------------------------------------------
// TinyFetch — POST https://api.fetch.tinyfish.ai
// ---------------------------------------------------------------------------

export type TinyFetchFormat = "markdown" | "html" | "json";

export interface TinyFetchParams {
  /** Up to 10 http(s) URLs. */
  urls: string[];
  /** Why we are fetching. Improves extraction quality; max 2000 chars. */
  purpose?: string;
  format?: TinyFetchFormat;
  /** Scope extraction to elements matching any of these CSS selectors. */
  includeSelectors?: string[];
  /** Remove elements matching these selectors before extraction. */
  excludeSelectors?: string[];
  /** Server-side cache lifetime in seconds. */
  ttl?: number;
  /** Per-URL timeout inside TinyFish, in milliseconds. */
  perUrlTimeoutMs?: number;
}

export interface TinyFetchResult {
  url: string;
  final_url: string;
  title: string | null;
  description: string | null;
  language: string | null;
  published_date: string | null;
  /** Extracted content. A string for "markdown"/"html", an object for "json". */
  text: string | Record<string, unknown> | null;
  format: string;
  latency_ms: number | null;
  not_modified?: boolean;
}

export interface TinyFetchErrorEntry {
  url: string;
  error: string;
  status?: number;
  unmatched_selectors?: string[];
  candidate_selectors?: string[];
}

export interface TinyFetchResponse {
  results: TinyFetchResult[];
  errors: TinyFetchErrorEntry[];
}

// ---------------------------------------------------------------------------
// Failure taxonomy
// ---------------------------------------------------------------------------

export type TinyFishFailureKind =
  | "unconfigured"
  | "auth"
  | "quota"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "timeout"
  | "network"
  | "upstream"
  | "invalid_response";

/**
 * A single failure type for every way a TinyFish call can go wrong, so callers
 * never have to interpret HTTP statuses themselves. `retryable` records whether
 * the caller may sensibly try again, and the message is always safe to show a
 * user — it never contains the API key or a raw upstream body.
 */
export class TinyFishError extends Error {
  readonly kind: TinyFishFailureKind;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(
    kind: TinyFishFailureKind,
    message: string,
    options: { status?: number | null; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "TinyFishError";
    this.kind = kind;
    this.status = options.status ?? null;
    this.retryable = options.retryable ?? RETRYABLE.has(kind);
  }
}

const RETRYABLE = new Set<TinyFishFailureKind>(["timeout", "network", "quota", "upstream"]);

/** Human-readable reason for a failure kind, for UI copy. */
export function describeTinyFishFailure(error: TinyFishError): string {
  switch (error.kind) {
    case "unconfigured":
      return "Live data is not configured on this server (TINYFISH_API_KEY is not set).";
    case "auth":
      return "The live data service rejected this server's API key.";
    case "quota":
      return "The live data service rate limit or quota was reached. Try again shortly.";
    case "forbidden":
      return "The live data service refused this request.";
    case "not_found":
      return "TinySearch is not available for this account.";
    case "bad_request":
      return "The live data service rejected the request parameters.";
    case "timeout":
      return "The live data service did not respond in time.";
    case "network":
      return "The live data service could not be reached.";
    case "invalid_response":
      return "The live data service returned an unexpected response.";
    case "upstream":
      return "The live data service reported an internal error.";
  }
}
