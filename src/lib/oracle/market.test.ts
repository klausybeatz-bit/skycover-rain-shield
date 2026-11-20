import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetRateLimiter } from "../tinyfish/client";
import type { DataSource } from "./types";
import { parseMandiPage } from "./market";

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

    expect(parseMandiPage(markdown, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) })).toEqual([]);
  });

  it("derives a modal price from the bounds only when both are present", () => {
    const markdown = [
      "| Market | Commodity | Min Price | Max Price | Date |",
      "| --- | --- | --- | --- | --- |",
      "| Sealdah | Rice | 2000 | 2400 | 2026-11-20 |",
    ].join("\n");

    const rows = parseMandiPage(markdown, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) });
    expect(rows[0]?.modalInr).toBe(2200);
  });

  it("leaves the modal price null when only one bound is stated", () => {
    const markdown = [
      "| Market | Commodity | Min Price | Max Price | Date |",
      "| --- | --- | --- | --- | --- |",
      "| Sealdah | Rice | 2000 | — | 2026-11-20 |",
    ].join("\n");

    const rows = parseMandiPage(markdown, { query: { crop: "Paddy" }, source: source(AGMARKNET_URL) });
    expect(rows[0]?.minInr).toBe(2000);
    expect(rows[0]?.modalInr).toBeNull();
  });
});
