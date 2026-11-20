/**
 * Validation rules for live readings.
 *
 * This is the layer that decides whether a number is allowed to travel further.
 * It is deliberately conservative: a reading that cannot be sourced, timed,
 * unit-normalised or plausibility-checked is rejected rather than carried
 * forward, because whatever survives this file may end up in a contract call.
 */

import type { RainfallPoint, WeatherIssue, WeatherQuality } from "./types";
import { roundMm } from "./units";

/**
 * Upper bound on a plausible single-day total. The world 24-hour record is
 * ~1,825 mm (Foc-Foc, Réunion), so anything above this is a parse error or a
 * different unit, not weather.
 */
export const MAX_DAILY_MM = 2000;

/** Matches SkyCoverInsurance.MAX_RAINFALL_MM: the contract rejects more. */
export const MAX_WINDOW_MM = 10_000;

/** A settlement-grade observation should not be older than this. */
export const MAX_OBSERVATION_AGE_MS = 6 * 60 * 60 * 1000;

/** Coordinate bounds, matching the contract's scaled 1e2 limits. */
export function isWithinCoordinateBounds(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function isPlausibleRainfall(mm: number, maxMm = MAX_DAILY_MM): boolean {
  return Number.isFinite(mm) && mm >= 0 && mm <= maxMm;
}

/** True when `at` is missing, unparseable, or older than `maxAgeMs`. */
export function isStale(at: string | null, nowMs: number, maxAgeMs = MAX_OBSERVATION_AGE_MS): boolean {
  if (!at) return true;
  const parsed = Date.parse(at);
  if (!Number.isFinite(parsed)) return true;
  return nowMs - parsed > maxAgeMs;
}

/** Sum a series, discarding implausible points rather than letting one poison it. */
export function sumRainfall(points: ReadonlyArray<RainfallPoint>): number {
  let total = 0;
  for (const point of points) {
    if (!isPlausibleRainfall(point.mm)) continue;
    total += point.mm;
  }
  return roundMm(total);
}

/**
 * Fold an hourly series into UTC-day totals.
 *
 * Open-Meteo's `timezone=auto` localises the `time` strings, so the day a
 * reading belongs to is the date prefix the provider already supplied; we group
 * on that rather than re-deriving it and risking an off-by-one against the
 * provider's own daily aggregation.
 */
export function dailyTotalsFromHourly(hourly: ReadonlyArray<RainfallPoint>): RainfallPoint[] {
  const byDay = new Map<string, { mm: number; kind: RainfallPoint["kind"] }>();
  for (const point of hourly) {
    if (!isPlausibleRainfall(point.mm)) continue;
    const day = point.at.slice(0, 10);
    const existing = byDay.get(day);
    if (existing) {
      existing.mm += point.mm;
    } else {
      byDay.set(day, { mm: point.mm, kind: point.kind });
    }
  }
  return [...byDay.entries()].map(([day, entry]) => ({
    at: day,
    mm: roundMm(entry.mm),
    kind: entry.kind,
  }));
}

/**
 * Compare a cross-checked figure against the primary total.
 * Returns null when no comparison is possible (nothing to compare).
 *
 * The comparison is one-sided on purpose. SkyCover pays when rainfall is *below*
 * a threshold, so the reading that can invalidate a claim is an independent
 * source reporting *more* rain than the structured series. A source reporting
 * less is consistent with the claim's direction and is not treated as a
 * contradiction: a window our series measures at 10 mm and the authority at
 * 0 mm is simply drier than we said, which changes nothing about eligibility.
 */
export function detectContradiction(
  primaryMm: number | null,
  crossMm: number | null,
  toleranceRatio = 0.5,
): boolean | null {
  if (primaryMm === null || crossMm === null) return null;
  if (crossMm <= primaryMm) return false;
  const excess = (crossMm - primaryMm) / Math.max(Math.abs(primaryMm), Number.EPSILON);
  return excess > toleranceRatio;
}

export interface QualityInput {
  latitude: number;
  longitude: number;
  observedDaily: ReadonlyArray<RainfallPoint>;
  observedHourly: ReadonlyArray<RainfallPoint>;
  /** Any forecast series, used to tell "forecast-only" apart from "no data". */
  forecastDaily: ReadonlyArray<RainfallPoint>;
  /**
   * True when the *window being reported on* contains forecast rainfall. This is
   * separate from `forecastDaily` because a dashboard always shows some forecast
   * ahead, while the claim window sits in the past.
   */
  forecastInWindow: boolean;
  observedThrough: string | null;
  windowTotalMm: number | null;
  windowEnded: boolean;
  unitCertain: boolean;
  contradiction: boolean | null;
  nowMs: number;
}

/**
 * Reduce every individual check into one verdict plus the reason codes behind
 * it, so the UI can explain *why* a reading is not trusted instead of showing a
 * bare "unverified" badge.
 */
export function assessWeatherQuality(input: QualityInput): WeatherQuality {
  const issues: WeatherIssue[] = [];

  if (!isWithinCoordinateBounds(input.latitude, input.longitude)) {
    issues.push("out-of-range-coordinates");
  }

  const hasObserved = input.observedDaily.length > 0 || input.observedHourly.length > 0;
  const hasForecast = input.forecastDaily.length > 0;

  if (!hasObserved) issues.push(hasForecast ? "forecast-only" : "no-data");
  if (!input.unitCertain) issues.push("unit-uncertain");

  if (hasObserved && isStale(input.observedThrough, input.nowMs)) issues.push("stale");
  if (!input.windowEnded) issues.push("window-not-ended");

  const implausible =
    input.observedDaily.some((point) => !isPlausibleRainfall(point.mm)) ||
    input.observedHourly.some((point) => !isPlausibleRainfall(point.mm)) ||
    (input.windowTotalMm !== null && input.windowTotalMm > MAX_WINDOW_MM);
  if (implausible) issues.push("implausible-rainfall");

  if (input.contradiction === true) issues.push("contradictory-sources");
  if (input.forecastInWindow) issues.push("forecast-in-window");

  const blocking: WeatherIssue[] = [
    "no-data",
    "out-of-range-coordinates",
    "implausible-rainfall",
    "forecast-only",
    "unit-uncertain",
  ];
  const containsForecast = input.forecastInWindow;

  return {
    ok: !issues.some((issue) => blocking.includes(issue)),
    issues,
    containsForecast,
    // Claim-grade is stricter than "ok": it additionally requires a finished
    // window, a fresh observation, mutually consistent sources and no forecast
    // anywhere in the number being reported.
    claimGrade:
      issues.length === 0 &&
      input.windowEnded &&
      hasObserved &&
      input.windowTotalMm !== null &&
      !containsForecast,
  };
}
