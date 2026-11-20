import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimiter } from "../tinyfish/client";
import { clearWeatherCache, getWeatherSnapshot } from "./weather";

/**
 * Weather oracle behaviour against mocked Open-Meteo and TinyFish responses.
 *
 * No test here touches the network, and no real credential is used. The clock
 * is fixed so observed/forecast boundaries and staleness are deterministic.
 */

const NOW_MS = Date.parse("2026-11-20T12:00:00Z");
const LOCATION = { name: "Cherrapunji, Meghalaya", latitude: 25.28, longitude: 91.7 };

/** Local hours 00:00–17:00 are in the past; 18:00–23:00 are still ahead. */
function forecastPayload(overrides: Record<string, unknown> = {}) {
  const hours = Array.from({ length: 24 }, (_, h) => `2026-11-20T${String(h).padStart(2, "0")}:00`);
  return {
    timezone: "Asia/Kolkata",
    utc_offset_seconds: 19800,
    hourly: { time: hours, rain: hours.map((_, h) => (h <= 17 ? 1 : 2)) },
    hourly_units: { rain: "mm" },
    daily: { time: ["2026-11-19", "2026-11-20", "2026-11-21"], rain_sum: [0, 12.5, 3] },
    daily_units: { rain_sum: "mm" },
    ...overrides,
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Routes a request to a fixture by URL fragment and counts the calls. */
function makeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    for (const [fragment, make] of Object.entries(routes)) {
      if (url.includes(fragment)) return make();
    }
    throw new Error(`Unrouted request: ${url}`);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const IMDS_SEARCH_URL = "https://imd.gov.in/rainfall";
const IMD_PAGE = {
  results: [
    {
      url: IMDS_SEARCH_URL,
      final_url: IMDS_SEARCH_URL,
      title: "IMD rainfall",
      description: null,
      language: "en",
      published_date: null,
      text: "Rainfall recorded: 12.6 mm in the last 24 hours.",
      format: "markdown",
      latency_ms: 12,
    },
  ],
  errors: [],
};

beforeEach(() => {
  clearWeatherCache();
  resetRateLimiter();
  delete process.env["TINYFISH_API_KEY"];
  // Several tests exercise upstream failures on purpose; keep their expected
  // diagnostic output out of the test log.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  clearWeatherCache();
  resetRateLimiter();
  delete process.env["TINYFISH_API_KEY"];
  vi.restoreAllMocks();
});

describe("observed vs forecast separation", () => {
  it("splits the series on the observation boundary and totals only observed days", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20", crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.unit).toBe("mm");
    // 0 mm on the 19th + 12.5 mm on the 20th — and nothing from the forecast.
    expect(snapshot.windowTotalMm).toBe(12.5);
    expect(snapshot.observedHourly).toHaveLength(18);
    expect(snapshot.observedHourly.every((point) => point.kind === "observed")).toBe(true);
    expect(snapshot.forecastHourly).toHaveLength(6);
    expect(snapshot.forecastHourly.every((point) => point.kind === "forecast")).toBe(true);
    expect(snapshot.forecastDaily.map((point) => point.at)).toEqual(["2026-11-21"]);
    expect(snapshot.quality.claimGrade).toBe(true);
    expect(snapshot.quality.containsForecast).toBe(false);
  });

  it("reports the current hour and today's total from the local calendar day", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    // The last elapsed hour is 17:00 local (11:30 UTC).
    expect(snapshot.currentMm).toBe(1);
    expect(snapshot.observedThrough).toBe("2026-11-20T11:30:00.000Z");
    // 18 elapsed hours at 1 mm each, counted in the provider's own local day.
    expect(snapshot.todayMm).toBe(18);
    expect(snapshot.timezone).toBe("Asia/Kolkata");
  });

  it("attributes every reading to a real source URL", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.sources[0]?.kind).toBe("api");
    expect(snapshot.sources[0]?.url).toContain("api.open-meteo.com/v1/forecast");
    expect(snapshot.sources[0]?.retrievedAt).toBe("2026-11-20T12:00:00.000Z");
  });
});

describe("missing and invalid data", () => {
  it("leaves an unmeasured day absent instead of reporting it as zero", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () =>
        json(
          forecastPayload({
            daily: { time: ["2026-11-19", "2026-11-20", "2026-11-21"], rain_sum: [null, 12.5, 3] },
          }),
        ),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-19", crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    // If a missing value were coerced to 0 the window would read 0 mm, which is
    // a claimable statement. It must stay unknown.
    expect(snapshot.windowTotalMm).toBeNull();
    expect(snapshot.quality.claimGrade).toBe(false);
  });

  it("treats an unreadable unit as uncertain rather than assuming millimetres", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () =>
        json(
          forecastPayload({
            hourly_units: { rain: "furlongs" },
            daily_units: { rain_sum: "furlongs" },
          }),
        ),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.quality.issues).toContain("unit-uncertain");
    expect(snapshot.quality.ok).toBe(false);
  });

  it("flags a stale observation but still reports it", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });
    // A day later, the newest reading is 24 h old.
    const laterMs = Date.parse("2026-11-21T12:00:00Z");

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20", crossCheck: false },
      { fetchImpl, now: () => laterMs },
    );

    expect(snapshot.quality.issues).toContain("stale");
    expect(snapshot.quality.ok).toBe(true);
    expect(snapshot.quality.claimGrade).toBe(false);
  });

  it("surfaces an upstream failure instead of returning an empty reading", async () => {
    const fetchImpl = (async () => new Response("down", { status: 502 })) as typeof fetch;

    await expect(
      getWeatherSnapshot(
        { location: LOCATION, crossCheck: false },
        { fetchImpl, now: () => NOW_MS },
      ),
    ).rejects.toThrow(/Open-Meteo forecast/);
  });
});

describe("TinyFish IMD cross-check", () => {
  it("is skipped, without failing, when no API key is configured", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20" },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.crossCheck).toBeNull();
    expect(snapshot.quality.claimGrade).toBe(true);
  });

  it("cross-checks the window total against the IMD page", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const { fetchImpl, calls } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
      "api.search.tinyfish.ai": () =>
        json({
          query: "q",
          total_results: 1,
          page: 0,
          results: [
            {
              position: 1,
              site_name: "imd.gov.in",
              title: "IMD",
              snippet: "",
              url: IMDS_SEARCH_URL,
            },
          ],
        }),
      "api.fetch.tinyfish.ai": () => json(IMD_PAGE),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20" },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.crossCheck?.mm).toBe(12.6);
    expect(snapshot.crossCheck?.agrees).toBe(true);
    expect(snapshot.sources.map((source) => source.id)).toContain("imd");
    expect(calls.some((url) => url.includes("api.fetch.tinyfish.ai"))).toBe(true);
  });

  it("withholds claim grade when the authority contradicts the structured series", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
      "api.search.tinyfish.ai": () =>
        json({
          query: "q",
          total_results: 1,
          page: 0,
          results: [
            {
              position: 1,
              site_name: "imd.gov.in",
              title: "IMD",
              snippet: "",
              url: IMDS_SEARCH_URL,
            },
          ],
        }),
      "api.fetch.tinyfish.ai": () =>
        json({
          results: [
            { ...IMD_PAGE.results[0]!, text: "Very heavy rainfall of 180 mm was recorded." },
          ],
          errors: [],
        }),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20" },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.crossCheck?.agrees).toBe(false);
    expect(snapshot.quality.issues).toContain("contradictory-sources");
    expect(snapshot.quality.claimGrade).toBe(false);
  });

  it("degrades gracefully when the cross-check transport fails", async () => {
    process.env["TINYFISH_API_KEY"] = "sk-tinyfish-test-value";
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
      "api.search.tinyfish.ai": () => new Response("nope", { status: 500 }),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20" },
      { fetchImpl, now: () => NOW_MS, tinyFish: { attempts: 1 } },
    );

    expect(snapshot.crossCheck).toBeNull();
    expect(snapshot.windowTotalMm).toBe(12.5);
  });
});

describe("caching", () => {
  it("reuses a recent reading instead of paying for another request", async () => {
    const { fetchImpl, calls } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });

    const first = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20", crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );
    const second = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-11-19", endDate: "2026-11-20", crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("re-fetches when a refresh is requested", async () => {
    const { fetchImpl, calls } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
    });

    await getWeatherSnapshot(
      { location: LOCATION, crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );
    await getWeatherSnapshot(
      { location: LOCATION, crossCheck: false },
      { fetchImpl, now: () => NOW_MS, refresh: true },
    );

    expect(calls).toHaveLength(2);
  });
});

describe("historical windows", () => {
  it("falls back to the archive API for a window older than the forecast API can reach", async () => {
    const { fetchImpl } = makeFetch({
      "api.open-meteo.com/v1/forecast": () => json(forecastPayload()),
      "archive-api.open-meteo.com/v1/archive": () =>
        json({ daily: { time: ["2026-08-01"], rain_sum: [7] }, daily_units: { rain_sum: "mm" } }),
    });

    const snapshot = await getWeatherSnapshot(
      { location: LOCATION, startDate: "2026-08-01", endDate: "2026-11-20", crossCheck: false },
      { fetchImpl, now: () => NOW_MS },
    );

    expect(snapshot.sources.map((source) => source.id)).toContain("open-meteo-archive");
    // 7 mm (archive) + 0 mm + 12.5 mm (forecast API's observed days).
    expect(snapshot.windowTotalMm).toBe(19.5);
  });
});
