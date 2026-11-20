import { describe, expect, it } from "vitest";

import type { RainfallPoint } from "./types";
import {
  assessWeatherQuality,
  dailyTotalsFromHourly,
  detectContradiction,
  isPlausibleRainfall,
  isStale,
  isWithinCoordinateBounds,
  sumRainfall,
  type QualityInput,
} from "./validate";

const NOW_MS = Date.parse("2026-11-20T12:00:00Z");
const FRESH = "2026-11-20T11:00:00.000Z";

function point(at: string, mm: number, kind: RainfallPoint["kind"] = "observed"): RainfallPoint {
  return { at, mm, kind };
}

/** A reading that passes every check, so each test can spoil exactly one thing. */
function input(overrides: Partial<QualityInput> = {}): QualityInput {
  return {
    latitude: 25.28,
    longitude: 91.7,
    observedDaily: [point("2026-11-20", 12)],
    observedHourly: [point(FRESH, 1)],
    forecastDaily: [],
    forecastInWindow: false,
    observedThrough: FRESH,
    windowTotalMm: 12,
    windowEnded: true,
    unitCertain: true,
    contradiction: null,
    nowMs: NOW_MS,
    ...overrides,
  };
}

describe("individual checks", () => {
  it("bounds coordinates to the globe", () => {
    expect(isWithinCoordinateBounds(25.28, 91.7)).toBe(true);
    expect(isWithinCoordinateBounds(91, 0)).toBe(false);
    expect(isWithinCoordinateBounds(0, 181)).toBe(false);
    expect(isWithinCoordinateBounds(Number.NaN, 0)).toBe(false);
  });

  it("rejects rainfall beyond the plausible daily maximum", () => {
    expect(isPlausibleRainfall(0)).toBe(true);
    expect(isPlausibleRainfall(1825)).toBe(true);
    expect(isPlausibleRainfall(2001)).toBe(false);
    expect(isPlausibleRainfall(-1)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as stale", () => {
    expect(isStale(null, NOW_MS)).toBe(true);
    expect(isStale("not-a-date", NOW_MS)).toBe(true);
    expect(isStale(FRESH, NOW_MS)).toBe(false);
    // Six hours is the boundary for a settlement-grade observation: the exact
    // boundary instant is still fresh, one second older is not.
    expect(isStale("2026-11-20T06:00:00.000Z", NOW_MS)).toBe(false);
    expect(isStale("2026-11-20T05:59:59.000Z", NOW_MS)).toBe(true);
  });

  it("discards an implausible point instead of letting it poison the sum", () => {
    expect(sumRainfall([point("a", 5), point("b", 99_999), point("c", 2)])).toBe(7);
  });

  it("folds hourly readings into the day the provider already assigned", () => {
    const daily = dailyTotalsFromHourly([
      point("2026-11-19T22:00:00.000Z", 1),
      point("2026-11-19T23:00:00.000Z", 2),
      point("2026-11-20T00:00:00.000Z", 3),
    ]);
    expect(daily).toEqual([point("2026-11-19", 3), point("2026-11-20", 3)]);
  });

  it("only calls sources contradictory when a comparison was possible", () => {
    expect(detectContradiction(null, 5)).toBeNull();
    expect(detectContradiction(10, null)).toBeNull();
    expect(detectContradiction(10, 0)).toBe(false);
    expect(detectContradiction(10, 11)).toBe(false);
    expect(detectContradiction(10, 100)).toBe(true);
  });
});

describe("weather quality verdicts", () => {
  it("marks a complete, fresh, observed reading claim-grade", () => {
    const quality = assessWeatherQuality(input());
    expect(quality.issues).toEqual([]);
    expect(quality.ok).toBe(true);
    expect(quality.claimGrade).toBe(true);
    expect(quality.containsForecast).toBe(false);
  });

  it("blocks a reading with no observations at all", () => {
    const quality = assessWeatherQuality(
      input({ observedDaily: [], observedHourly: [], observedThrough: null, windowTotalMm: null }),
    );
    expect(quality.issues).toContain("no-data");
    expect(quality.ok).toBe(false);
    expect(quality.claimGrade).toBe(false);
  });

  it("refuses a forecast-only reading and says so distinctly", () => {
    const quality = assessWeatherQuality(
      input({
        observedDaily: [],
        observedHourly: [],
        observedThrough: null,
        windowTotalMm: null,
        forecastDaily: [point("2026-11-21", 40, "forecast")],
      }),
    );
    expect(quality.issues).toContain("forecast-only");
    expect(quality.ok).toBe(false);
    expect(quality.claimGrade).toBe(false);
  });

  it("keeps a forecast elsewhere from tainting a past window", () => {
    // A dashboard always shows the week ahead; that must not make a finished,
    // fully observed window ineligible.
    const quality = assessWeatherQuality(
      input({ forecastDaily: [point("2026-11-25", 40, "forecast")], forecastInWindow: false }),
    );
    expect(quality.issues).toEqual([]);
    expect(quality.containsForecast).toBe(false);
    expect(quality.claimGrade).toBe(true);
  });

  it("disqualifies a window that itself contains forecast rainfall", () => {
    const quality = assessWeatherQuality(input({ forecastInWindow: true }));
    expect(quality.issues).toContain("forecast-in-window");
    expect(quality.containsForecast).toBe(true);
    expect(quality.claimGrade).toBe(false);
  });

  it("records staleness without blocking the reading outright", () => {
    const quality = assessWeatherQuality(
      input({ observedThrough: "2026-11-18T00:00:00.000Z" }),
    );
    expect(quality.issues).toContain("stale");
    expect(quality.ok).toBe(true);
    // Stale data is still readable, but it can never back a claim.
    expect(quality.claimGrade).toBe(false);
  });

  it("withholds claim grade while the policy window is still open", () => {
    const quality = assessWeatherQuality(input({ windowEnded: false }));
    expect(quality.issues).toContain("window-not-ended");
    expect(quality.ok).toBe(true);
    expect(quality.claimGrade).toBe(false);
  });

  it("blocks out-of-range coordinates, uncertain units and implausible totals", () => {
    expect(assessWeatherQuality(input({ latitude: 120 })).ok).toBe(false);
    expect(assessWeatherQuality(input({ unitCertain: false })).ok).toBe(false);
    expect(assessWeatherQuality(input({ windowTotalMm: 20_000 })).ok).toBe(false);
  });

  it("reports a contradiction between sources", () => {
    const quality = assessWeatherQuality(input({ contradiction: true }));
    expect(quality.issues).toContain("contradictory-sources");
    expect(quality.claimGrade).toBe(false);
  });
});
