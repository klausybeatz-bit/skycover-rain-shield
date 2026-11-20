import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiter } from "../tinyfish/client";
import type { DataSource } from "./types";
import { getMandiPrices, parseMandiPage } from "./market";

const AGMARKNET_URL = "https://agmarknet.gov.in/SearchCmmMkt.aspx?Tx_Commodity=Rice";
const NEWS_URL = "https://example-news.test/mandi-prices";

function source(url: string): DataSource {
  return { id: "test", name: "test", url, kind: "web", retrievedAt: "2026-11-20T12:00:00.000Z" };
}

const TABLE = [
  "| State | District | Market | Commodity | Min Price | Max Price | Modal Price | Date |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| West Bengal | Kolkata | Sealdah | Rice | 2100 | 2400 | 2250 | 2026-11-20 |",
  "| West Bengal | Kolkata | Sealdah | Rice | 2000 | 2300 | 2000 | 19/11/2026 |",
].join("\n");

beforeEach(() => {
  resetRateLimiter();
  delete process.env["TINYFISH_API_KEY"];
});

afterEach(() => {
  resetRateLimiter();
  delete process.env["TINYFISH_API_KEY"];
  vi.restoreAllMocks();
});

describe("mandi table parsing", () => {
  it("reads min, max, modal and date out of an official AGMARKNET table", () => {
    const rows = parseMandiPage(TABLE, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) });

    expect(rows).toHaveLength(2);
    const latest = rows[0]!;
    expect(latest.crop).toBe("Rice");
    expect(latest.market).toBe("Sealdah");
    expect(latest.district).toBe("Kolkata");
    expect(latest.state).toBe("West Bengal");
    expect(latest.minInr).toBe(2100);
    expect(latest.maxInr).toBe(2400);
    expect(latest.modalInr).toBe(2250);
    expect(latest.priceDate).toBe("2026-11-20");
    expect(latest.unit).toBe("INR/quintal");
  });

  it("reads a day-first date, which is how Indian mandi sources publish", () => {
    const rows = parseMandiPage(TABLE, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) });
    expect(rows[1]?.priceDate).toBe("2026-11-19");
  });

  it("refuses an unlabelled unit from a non-official source", () => {
    // Assuming a unit here would multiply or divide the price by 100.
    const rows = parseMandiPage(TABLE, { query: { crop: "Paddy" }, source: source(NEWS_URL) });
    expect(rows).toEqual([]);
  });

  it("normalises a non-official source that states its unit", () => {
    const markdown = [
      "| Market | Commodity | Min | Max | Modal | Date |",
      "| --- | --- | --- | --- | --- | --- |",
      "| Sealdah | Rice | 21.5 | 24 | 22.5 | 2026-11-20 |",
    ].join("\n");

    const rows = parseMandiPage(markdown, {
      query: { crop: "Paddy" },
      source: source(NEWS_URL),
      pageText: `${markdown}\nAll prices are in Rs per kg.`,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.modalInr).toBe(2250);
    expect(rows[0]?.unit).toBe("INR/quintal");
  });

  it("drops rows that state no price at all", () => {
    const markdown = [
      "| State | District | Market | Commodity | Min Price | Max Price | Modal Price | Date |",
      "| --- | --- | --- | --- | --- | --- | --- | --- |",
      "| West Bengal | Kolkata | Sealdah | Rice | — | — | — | 2026-11-20 |",
    ].join("\n");

    expect(
      parseMandiPage(markdown, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) }),
    ).toEqual([]);
  });

  it("derives a modal price from the bounds only when both are present", () => {
    const markdown = [
      "| Market | Commodity | Min Price | Max Price | Date |",
      "| --- | --- | --- | --- | --- |",
      "| Sealdah | Rice | 2000 | 2400 | 2026-11-20 |",
    ].join("\n");

    const rows = parseMandiPage(markdown, {
      query: { crop: "Paddy" },
      source: source(AGMARKNET_URL),
    });
    expect(rows[0]?.modalInr).toBe(2200);
  });

  it("leaves the modal price null when only one bound is stated", () => {
    const markdown = [
      "| Market | Commodity | Min Price | Max Price | Date |",
      "| --- | --- | --- | --- | --- |",
      "| Sealdah | Rice | 2000 | — | 2026-11-20 |",
    ].join("\n");

    const rows = parseMandiPage(markdown, {
      query: { crop: "Paddy" },
      source: source(AGMARKNET_URL),
    });
    expect(rows[0]?.minInr).toBe(2000);
    expect(rows[0]?.modalInr).toBeNull();
  });
});

describe("mandi lookup failure handling", () => {
  it("turns an upstream failure into an unavailable result and logs the category", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("boom", { status: 500 }));

    const result = await getMandiPrices(
      { crop: "Paddy" },
      { refresh: true, tinyFish: { fetchImpl, attempts: 1 } },
    );

    expect(result.available).toBe(false);
    expect(result.latest).toBeNull();
    expect(result.reason).toContain("internal error");

    const logged = consoleError.mock.calls.flat().join(" ");
    expect(logged).toContain("mandi.lookup.failed");
    expect(logged).toContain("upstream");
    expect(logged).toContain("500");
    expect(logged).not.toContain("sk-tinyfish-test-value");
  });

  it("reports an unreachable service without inventing a price", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("Failed to fetch");
    });

    const result = await getMandiPrices(
      { crop: "Paddy" },
      { refresh: true, tinyFish: { fetchImpl, attempts: 1 } },
    );

    expect(result.available).toBe(false);
    expect(result.latest).toBeNull();
    expect(result.reason).toBe("The live data service could not be reached.");
  });
});

describe("row integrity guards", () => {
  it("rejects a row whose stated minimum exceeds its stated maximum", () => {
    const markdown = [
      "| Commodity | Min Price | Max Price | Modal Price | Market | Date |",
      "| --- | --- | --- | --- | --- | --- |",
      "| Paddy | 8950 | 959 | 4954.5 | Sealdah | 2026-11-20 |",
    ].join("\n");

    expect(
      parseMandiPage(markdown, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) }),
    ).toEqual([]);
  });

  it("rejects a price row that names no mandi and carries no date", () => {
    const markdown = [
      "| Commodity | Modal Price | Change | Trend |",
      "| --- | --- | --- | --- |",
      "| Paddy | 2300 | Stable | Flat |",
    ].join("\n");

    expect(
      parseMandiPage(markdown, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) }),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Regression: the malformed Paddy response seen in production
// ---------------------------------------------------------------------------

const MALFORMED_SOURCE_URL = "https://tgkagro.com/prices/";

/**
 * Verbatim excerpt of the live page that produced the malformed Paddy rows
 * (captured 2026-11-20). It does carry a header row, but no cell in it contains
 * "price" or "modal", so findHeader() does not recognise it — and the old
 * positional fallback then read "100 kg" and "30-day trend" as prices, yielding
 * min 100 / max 30 / modal 65 INR per quintal.
 */
const MALFORMED_PADDY_PAGE = [
  "Indicative reference prices",
  "Updated 20 November 2026",
  "",
  "| Commodity | Type | Rupees per quintal (100 kg) | US dollars per tonne | Change in a week | 30-day trend |",
  "| --- | --- | --- | --- | --- | --- |",
  "| Kabuli Chana | Whole | ₹8,950 | $959 | Stable |  |",
  "| Desi Chana | Whole | ₹7,000 | $750 | Stable |  |",
  "| Rice (Non-Basmati) | Non-basmati | ₹3,800 | $407 | Stable |  |",
  "",
  "Wholesale mandi prices from Agmarknet, converted to USD at the day's exchange rate.",
].join("\n");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes a search call to the malformed source and a fetch call to its markdown. */
function malformedFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    if (String(input).includes("api.search.tinyfish.ai")) {
      return json({
        query: "q",
        total_results: 1,
        page: 0,
        results: [
          {
            position: 1,
            site_name: "tgkagro.com",
            title: "Prices",
            snippet: "",
            url: MALFORMED_SOURCE_URL,
          },
        ],
      });
    }
    return json({
      results: [
        {
          url: MALFORMED_SOURCE_URL,
          final_url: MALFORMED_SOURCE_URL,
          title: "Prices",
          description: null,
          language: "en",
          published_date: null,
          text: MALFORMED_PADDY_PAGE,
          format: "markdown",
          latency_ms: 10,
        },
      ],
      errors: [],
    });
  }) as typeof fetch;
}

describe("malformed Paddy source", () => {
  it("reads no price at all from a headerless third-party page", () => {
    const rows = parseMandiPage(MALFORMED_PADDY_PAGE, {
      query: { crop: "Paddy" },
      source: source(MALFORMED_SOURCE_URL),
    });

    expect(rows).toEqual([]);
  });

  it("still reads the positional layout of an official source", () => {
    const markdown = "West Bengal\tKolkata\tSealdah\tRice\t2100\t2400\t2250\t2026-11-20";
    const rows = parseMandiPage(markdown, {
      query: { crop: "Paddy" },
      source: source(AGMARKNET_URL),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.minInr).toBe(2100);
    expect(rows[0]?.modalInr).toBe(2250);
    expect(rows[0]?.priceDate).toBe("2026-11-20");
  });

  it("reports an honest unavailable state instead of the fabricated price", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";

    const result = await getMandiPrices(
      { crop: "Paddy" },
      { refresh: true, tinyFish: { fetchImpl: malformedFetch(), attempts: 1 } },
    );

    expect(result.available).toBe(false);
    expect(result.latest).toBeNull();
    expect(result.history).toEqual([]);
    expect(result.reason).toContain("none stated a usable price");
    expect(result.sources).toHaveLength(1);
  });
});
