import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { resetRateLimiter, tinyFetch, tinySearch } from "./client";
import { TinyFishError } from "./types";

/**
 * Transport behaviour of the TinyFish client. Every test injects its own fetch,
 * so nothing here reaches the network and no credential is used.
 *
 * The values below are made-up placeholders.
 */

const ENV_KEYS = [
  "TINYFISH_API_KEY",
  "TINYFISH_RATE_LIMIT_PER_MINUTE",
  "TINYFISH_RATE_LIMIT",
] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function searchBody(count = 1) {
  return {
    query: "q",
    total_results: count,
    page: 0,
    results: Array.from({ length: count }, (_, i) => ({
      position: i + 1,
      site_name: "imd.gov.in",
      title: `Result ${i + 1}`,
      snippet: "snippet",
      url: `https://imd.gov.in/page-${i + 1}`,
    })),
  };
}

/** Captures the client's diagnostic output so tests can assert it is safe. */
let consoleError: MockInstance;

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetRateLimiter();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
  resetRateLimiter();
  vi.restoreAllMocks();
});

describe("authentication", () => {
  it("fails fast with a clear error when the API key is not configured", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(tinySearch({ query: "x" }, { fetchImpl })).rejects.toMatchObject({
      name: "TinyFishError",
      kind: "unconfigured",
      retryable: false,
    });
    // Nothing was sent: an unconfigured server must not call out at all.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the key as an X-API-Key header and never in the URL", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(searchBody()));

    await tinySearch({ query: "rainfall" }, { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain("sk-tinyfish-test-value");
    expect((init?.headers as Record<string, string>)["X-API-Key"]).toBe("sk-tinyfish-test-value");
  });

  it("classifies a 401 as an auth failure and does not retry it", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "bad key" }, 401));

    await expect(tinySearch({ query: "x" }, { fetchImpl })).rejects.toMatchObject({ kind: "auth" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never forwards the upstream error body into the error message", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("sk-tinyfish-test-value leaked", { status: 500 }),
    );

    const error = await tinySearch({ query: "x" }, { fetchImpl, attempts: 1 }).catch((e) => e);
    expect(error).toBeInstanceOf(TinyFishError);
    expect(String(error.message)).not.toContain("sk-tinyfish-test-value");
  });
});

describe("timeouts and retries", () => {
  it("times out a hanging request and reports it as retryable", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    await expect(
      tinySearch({ query: "x" }, { fetchImpl, attempts: 1, timeoutMs: 5 }),
    ).rejects.toMatchObject({ kind: "timeout", retryable: true });
  });

  it("reports a transport failure as a network error", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 1 })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("retries a 5xx and succeeds on a later attempt", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse(searchBody()));

    const response = await tinySearch({ query: "x" }, { fetchImpl, attempts: 3 });
    expect(response.results).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after the configured number of attempts", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "boom" }, 503));

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 2 })).rejects.toMatchObject({
      kind: "upstream",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a 429 quota response", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "slow down" }, 429));

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 2 })).rejects.toMatchObject({
      kind: "quota",
    });
  });
});

describe("self-imposed rate limiting", () => {
  it("refuses to exceed the per-minute budget instead of being throttled upstream", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    process.env["TINYFISH_RATE_LIMIT_PER_MINUTE"] = "2";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(searchBody()));
    const now = () => 1_000_000;

    await tinySearch({ query: "one" }, { fetchImpl, now });
    await tinySearch({ query: "two" }, { fetchImpl, now });

    await expect(tinySearch({ query: "three" }, { fetchImpl, now })).rejects.toMatchObject({
      kind: "quota",
      retryable: false,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("response validation", () => {
  it("rejects a payload whose results are not an array", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: "nope" }));

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 1 })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("rejects a non-JSON body from a successful response", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response("<html>oops</html>", { status: 200 }),
    );

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 1 })).rejects.toMatchObject({
      kind: "invalid_response",
    });
  });

  it("refuses a fetch with no usable URL before calling out", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [], errors: [] }));

    await expect(tinyFetch({ urls: ["not-a-url"] }, { fetchImpl })).rejects.toMatchObject({
      kind: "bad_request",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("drops URLs beyond the documented batch ceiling", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ results: [], errors: [] }));

    await tinyFetch(
      { urls: Array.from({ length: 15 }, (_, i) => `https://example.com/${i}`) },
      { fetchImpl },
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]?.body)) as { urls: string[] };
    expect(body.urls).toHaveLength(10);
  });
});

describe("diagnostic logging", () => {
  const logText = () => consoleError.mock.calls.flat().join(" ");
  const lastRecord = () =>
    JSON.parse(String(consoleError.mock.calls[0]![1])) as Record<string, unknown>;

  it("records the category, status and attempt count of an upstream failure", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: "boom" }, 503));

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 1 })).rejects.toMatchObject({
      kind: "upstream",
    });

    const record = lastRecord();
    expect(record["event"]).toBe("tinyfish.request.failed");
    expect(record["host"]).toBe("api.search.tinyfish.ai");
    expect(record["kind"]).toBe("upstream");
    expect(record["status"]).toBe(503);
    expect(record["attempts"]).toBe(1);
  });

  it("records a network rejection without leaking the API key", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 1 })).rejects.toMatchObject({
      kind: "network",
    });

    expect(logText()).toContain("network");
    expect(logText()).toContain("TypeError");
    expect(logText()).not.toContain("sk-tinyfish-test-value");
  });

  it("records an unconfigured server and never calls out", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(tinySearch({ query: "x" }, { fetchImpl })).rejects.toMatchObject({
      kind: "unconfigured",
    });

    const record = lastRecord() as { key: { present: boolean } };
    expect(record.key.present).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flags a credential holding a header-breaking character, without logging it", async () => {
    // A newline wrapped into the value by a paste survives readEnv's trim and
    // makes the runtime reject the request — the case this diagnostic exists for.
    const malformed = "sk-live\nsecret-half";
    process.env["TINYFISH_API_KEY"] = malformed;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(tinySearch({ query: "x" }, { fetchImpl, attempts: 1 })).rejects.toMatchObject({
      kind: "network",
    });

    const record = lastRecord() as {
      key: { present: boolean; length: number; unsafeHeaderChars: boolean };
    };
    expect(record.key.present).toBe(true);
    expect(record.key.unsafeHeaderChars).toBe(true);
    expect(record.key.length).toBe(malformed.length);
    expect(logText()).not.toContain("secret-half");
  });

  it("stays silent on a successful call", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(searchBody()));

    await tinySearch({ query: "x" }, { fetchImpl });

    expect(consoleError).not.toHaveBeenCalled();
  });
});
