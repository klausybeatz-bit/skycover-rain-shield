/**
 * Live weather oracle.
 *
 * Rainfall is read from Open-Meteo's structured, keyless JSON APIs (the
 * authoritative machine-readable meteorological source available to a Worker),
 * and optionally cross-checked against the India Meteorological Department via
 * TinyFish (TinySearch to locate the page, TinyFetch to read it). Every value
 * keeps the URL and the observation time it came from.
 *
 * Two rules shape the whole file:
 *
 *  1. Observed and forecast rainfall are never mixed. `windowTotalMm` — the
 *     only number that may reach the insurance contract — is built exclusively
 *     from *observed* days. A forecast is carried separately and can never be
 *     presented as a measurement.
 *  2. A missing value is null, never zero. Zero is a legitimate rainfall
 *     reading, so conflating "not measured" with "did not rain" would silently
 *     pay or deny a claim on absent data.
 *
 * This module must only be imported from server code paths: it calls the
 * TinyFish client, which holds the API key.
 */

import { cacheKeyOf, TtlCache } from "../tinyfish/cache";
import { tinyFetch, tinySearch, type TinyFishCallOptions } from "../tinyfish/client";
import { TinyFishError, type TinyFetchResult } from "../tinyfish/types";
import type {
  DataSource,
  LocationRef,
  RainfallPoint,
  SourceCrossCheck,
  WeatherSnapshot,
} from "./types";
import { roundMm, toMillimetres } from "./units";
import {
  assessWeatherQuality,
  dailyTotalsFromHourly,
  detectContradiction,
  isPlausibleRainfall,
  MAX_DAILY_MM,
} from "./validate";

// ---------------------------------------------------------------------------
// Endpoints and limits
// ---------------------------------------------------------------------------

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_ENDPOINT = "https://archive-api.open-meteo.com/v1/archive";

/** Open-Meteo caps `past_days` at 92; beyond that we fall back to the archive. */
const MAX_PAST_DAYS = 92;
/** Enough forecast to show the coming week without a second request. */
const FORECAST_DAYS = 7;
/** Rainfall moves slowly and this is a rate-limited, paid boundary. */
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

const weatherCache = new TtlCache<WeatherSnapshot>({ ttlMs: WEATHER_CACHE_TTL_MS, maxEntries: 100 });

/** Drop every cached observation. Used by tests and by a manual refresh. */
export function clearWeatherCache(): void {
  weatherCache.clear();
}

// ---------------------------------------------------------------------------
// Query / options
// ---------------------------------------------------------------------------

export interface WeatherQuery {
  location: LocationRef;
  /** Policy window start, YYYY-MM-DD. Defaults to today. */
  startDate?: string;
  /** Policy window end, YYYY-MM-DD. Defaults to today. */
  endDate?: string;
  /** Try the TinyFish/IMD cross-check. Defaults to true; skipped without a key. */
  crossCheck?: boolean;
}

export interface WeatherServiceOptions {
  /** Injected for tests; defaults to the runtime fetch. */
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to Date.now. */
  now?: () => number;
  /** Transport knobs forwarded to the TinyFish client. */
  tinyFish?: TinyFishCallOptions;
  /** Bypass the cache and re-fetch. */
  refresh?: boolean;
}

/** Raised when the structured provider cannot be read at all. */
export class WeatherUnavailableError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "WeatherUnavailableError";
  }
}

// ---------------------------------------------------------------------------
// Date helpers (all window maths is calendar-day based, never sub-day)
// ---------------------------------------------------------------------------

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayDiff(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------

interface OpenMeteoResponse {
  timezone?: string;
  utc_offset_seconds?: number;
  hourly?: { time?: string[]; rain?: (number | null)[] };
  hourly_units?: { rain?: string };
  daily?: { time?: string[]; rain_sum?: (number | null)[] };
  daily_units?: { rain_sum?: string };
}

interface SeriesResult {
  source: DataSource;
  observedHourly: RainfallPoint[];
  observedDaily: RainfallPoint[];
  forecastHourly: RainfallPoint[];
  forecastDaily: RainfallPoint[];
  currentMm: number | null;
  todayMm: number | null;
  observedThrough: string | null;
  timezone: string;
  utcOffsetSeconds: number;
  unitCertain: boolean;
}

function buildForecastUrl(query: WeatherQuery, pastDays: number): string {
  const url = new URL(FORECAST_ENDPOINT);
  url.searchParams.set("latitude", String(query.location.latitude));
  url.searchParams.set("longitude", String(query.location.longitude));
  url.searchParams.set("hourly", "rain");
  url.searchParams.set("daily", "rain_sum");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("past_days", String(pastDays));
  url.searchParams.set("forecast_days", String(FORECAST_DAYS));
  return url.toString();
}

async function readJson(
  url: string,
  fetchImpl: typeof fetch,
  label: string,
): Promise<OpenMeteoResponse> {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new WeatherUnavailableError(`${label} responded with HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => null)) as OpenMeteoResponse | null;
  if (!body || typeof body !== "object") {
    throw new WeatherUnavailableError(`${label} returned a body that could not be read.`);
  }
  return body;
}

/**
 * Absolute UTC instant of a naive local timestamp Open-Meteo returns when
 * `timezone=auto`. The provider omits the offset, so it is applied from the
 * `utc_offset_seconds` field rather than guessed from the server's own zone.
 */
function localNaiveToEpochMs(naive: string, utcOffsetSeconds: number): number | null {
  const asIfUtc = Date.parse(`${naive.length === 16 ? `${naive}:00` : naive}Z`);
  if (!Number.isFinite(asIfUtc)) return null;
  return asIfUtc - utcOffsetSeconds * 1000;
}

function convertSeries(
  values: ReadonlyArray<number | null | undefined>,
  unit: string | undefined,
): { points: number[]; certain: boolean } {
  const points: number[] = [];
  let certain = unit !== undefined && toMillimetres(1, unit) !== null;
  for (const value of values) {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      points.push(Number.NaN);
      continue;
    }
    const mm = unit ? toMillimetres(value, unit) : value;
    if (mm === null) {
      certain = false;
      points.push(Number.NaN);
    } else {
      points.push(mm);
    }
  }
  return { points, certain };
}

async function fetchForecastSeries(
  query: WeatherQuery,
  windowStart: string,
  nowMs: number,
  fetchImpl: typeof fetch,
): Promise<SeriesResult> {
  const requireWindow = dayDiff(windowStart, isoDay(nowMs));
  const pastDays = Math.min(Math.max(requireWindow, 0), MAX_PAST_DAYS);
  const url = buildForecastUrl(query, pastDays);
  const body = await readJson(url, fetchImpl, "Open-Meteo forecast");

  const utcOffsetSeconds = Number.isFinite(body.utc_offset_seconds) ? (body.utc_offset_seconds as number) : 0;
  const localToday = isoDay(nowMs + utcOffsetSeconds * 1000);

  const hourlyTimes = body.hourly?.time ?? [];
  const hourlyConverted = convertSeries(body.hourly?.rain ?? [], body.hourly_units?.rain);
  const dailyTimes = body.daily?.time ?? [];
  const dailyConverted = convertSeries(body.daily?.rain_sum ?? [], body.daily_units?.rain_sum);

  const observedHourly: RainfallPoint[] = [];
  const forecastHourly: RainfallPoint[] = [];
  let todayMm = 0;
  let todayHours = 0;
  for (let i = 0; i < hourlyTimes.length; i += 1) {
    const mm = hourlyConverted.points[i];
    const naive = hourlyTimes[i];
    if (mm === undefined || Number.isNaN(mm) || !naive) continue;
    const epochMs = localNaiveToEpochMs(naive, utcOffsetSeconds);
    if (epochMs === null) continue;
    const observed = epochMs <= nowMs;
    const point: RainfallPoint = {
      at: new Date(epochMs).toISOString(),
      mm: roundMm(mm),
      kind: observed ? "observed" : "forecast",
    };
    if (observed) {
      observedHourly.push(point);
      // "Today" is the provider's local calendar day, which is the day the
      // farmer experiences — not the UTC day the instant happens to fall in.
      if (naive.slice(0, 10) === localToday) {
        todayMm += point.mm;
        todayHours += 1;
      }
    } else {
      forecastHourly.push(point);
    }
  }

  const observedDaily: RainfallPoint[] = [];
  const forecastDaily: RainfallPoint[] = [];
  for (let i = 0; i < dailyTimes.length; i += 1) {
    const mm = dailyConverted.points[i];
    const day = dailyTimes[i];
    if (mm === undefined || Number.isNaN(mm) || !day) continue;
    // A day is "observed" only once it is today or earlier in the provider's
    // own local calendar, because that is how Open-Meteo aggregates it.
    const point: RainfallPoint = { at: day, mm: roundMm(mm), kind: day <= localToday ? "observed" : "forecast" };
    (point.kind === "observed" ? observedDaily : forecastDaily).push(point);
  }

  const currentMm = observedHourly.length > 0 ? observedHourly[observedHourly.length - 1]!.mm : null;

  return {
    source: {
      id: "open-meteo-forecast",
      name: "Open-Meteo (rainfall analysis + forecast)",
      url,
      kind: "api",
      retrievedAt: new Date(nowMs).toISOString(),
    },
    observedHourly,
    observedDaily,
    forecastHourly,
    forecastDaily,
    // "Current rainfall" is the last elapsed hour, so it always belongs to the
    // observed series rather than to a model's estimate of the present moment.
    currentMm,
    todayMm: todayHours > 0 ? roundMm(todayMm) : null,
    observedThrough: observedHourly.length > 0 ? observedHourly[observedHourly.length - 1]!.at : null,
    timezone: body.timezone ?? "auto",
    utcOffsetSeconds,
    unitCertain: hourlyConverted.certain && dailyConverted.certain,
  };
}

async function fetchArchiveDaily(
  query: WeatherQuery,
  startDate: string,
  endDate: string,
  nowMs: number,
  fetchImpl: typeof fetch,
): Promise<{ source: DataSource; daily: RainfallPoint[]; unitCertain: boolean } | null> {
  const url = new URL(ARCHIVE_ENDPOINT);
  url.searchParams.set("latitude", String(query.location.latitude));
  url.searchParams.set("longitude", String(query.location.longitude));
  url.searchParams.set("start_date", startDate);
  url.searchParams.set("end_date", endDate);
  url.searchParams.set("daily", "rain_sum");
  url.searchParams.set("timezone", "auto");

  let body: OpenMeteoResponse;
  try {
    body = await readJson(url.toString(), fetchImpl, "Open-Meteo archive");
  } catch (error) {
    // The structured forecast series is still usable, so an archive outage
    // degrades the window rather than failing the whole snapshot.
    if (error instanceof WeatherUnavailableError) return null;
    throw error;
  }

  const times = body.daily?.time ?? [];
  const converted = convertSeries(body.daily?.rain_sum ?? [], body.daily_units?.rain_sum);
  const daily: RainfallPoint[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const mm = converted.points[i];
    if (mm === undefined || Number.isNaN(mm) || !times[i]) continue;
    daily.push({ at: times[i]!, mm: roundMm(mm), kind: "observed" });
  }

  return {
    source: {
      id: "open-meteo-archive",
      name: "Open-Meteo Historical Weather API (ERA5)",
      url: url.toString(),
      kind: "api",
      retrievedAt: new Date(nowMs).toISOString(),
    },
    daily,
    unitCertain: converted.certain,
  };
}

// ---------------------------------------------------------------------------
// TinyFish / IMD cross-check
// ---------------------------------------------------------------------------

/** Domains that count as the meteorological authority for an Indian location. */
const AUTHORITATIVE_WEATHER_DOMAINS = "imd.gov.in,mausam.imd.gov.in,internal.imd.gov.in";

/**
 * Pull the first rainfall figure out of a page of prose. Deliberately narrow:
 * it accepts an explicit mm/cm label only, so a stray number in navigation
 * chrome is not mistaken for a measurement.
 */
export function extractMillimetres(text: string): number | null {
  if (!text) return null;
  const cm = text.match(/(\d+(?:\.\d+)?)\s*(?:cm|centimetres?|centimeters?)\b/i);
  if (cm) {
    const mm = toMillimetres(Number.parseFloat(cm[1]!), "cm");
    if (mm !== null && isPlausibleRainfall(mm)) return mm;
  }
  const mmMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:mm|millimetres?|millimeters?)\b/i);
  if (mmMatch) {
    const value = Number.parseFloat(mmMatch[1]!);
    if (Number.isFinite(value) && isPlausibleRainfall(value)) return roundMm(value);
  }
  return null;
}

function pickAuthoritativeResult(
  results: ReadonlyArray<{ url: string; title: string }>,
): { url: string; title: string } | null {
  const authoritative = results.find((result) => /imd\.gov\.in/i.test(result.url));
  return authoritative ?? results[0] ?? null;
}

function flattenText(result: TinyFetchResult): string {
  if (typeof result.text === "string") return result.text;
  if (result.text && typeof result.text === "object") {
    try {
      return JSON.stringify(result.text);
    } catch {
      return "";
    }
  }
  return "";
}

/**
 * Cross-check the structured window total against IMD. Returns null whenever a
 * comparison cannot be made — including when TinyFish is unconfigured, which is
 * the expected state until TINYFISH_API_KEY is set on the Worker.
 */
export async function crossCheckWithImd(
  location: LocationRef,
  windowTotalMm: number | null,
  nowMs: number,
  tinyFish: TinyFishCallOptions | undefined,
): Promise<SourceCrossCheck | null> {
  try {
    const search = await tinySearch(
      {
        query: `IMD rainfall ${location.name} today observed mm`,
        purpose:
          "Cross-check an official India Meteorological Department rainfall reading for a parametric rain-insurance claim.",
        location: "IN",
        language: "en",
        domainType: "web",
        recencyMinutes: 1440,
      },
      tinyFish,
    );

    const chosen = pickAuthoritativeResult(search.results.map((r) => ({ url: r.url, title: r.title })));
    if (!chosen) return null;

    const fetched = await tinyFetch(
      {
        urls: [chosen.url],
        format: "markdown",
        purpose: `Read the observed rainfall in millimetres for ${location.name}.`,
      },
      tinyFish,
    );

    const page = fetched.results[0];
    if (!page) return null;

    const source: DataSource = {
      id: "imd",
      name: "India Meteorological Department",
      url: page.final_url || page.url,
      kind: "web",
      retrievedAt: new Date(nowMs).toISOString(),
    };

    const mm = extractMillimetres(flattenText(page));
    const contradiction = detectContradiction(windowTotalMm, mm);
    return {
      source,
      mm,
      agrees: contradiction === null ? null : !contradiction,
      note:
        mm === null
          ? "The IMD page was retrieved but did not state a rainfall figure in mm."
          : contradiction === true
            ? "The IMD figure disagrees with the structured series beyond tolerance."
            : "Consistent with the structured Open-Meteo series.",
    };
  } catch (error) {
    // An unconfigured or failing cross-check must not take the weather down:
    // Open-Meteo is itself an accepted authoritative source.
    if (error instanceof TinyFishError) return null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

function mergeObservedDaily(
  earlier: ReadonlyArray<RainfallPoint>,
  later: ReadonlyArray<RainfallPoint>,
): RainfallPoint[] {
  const byDay = new Map<string, RainfallPoint>();
  for (const point of earlier) byDay.set(point.at, point);
  for (const point of later) byDay.set(point.at, point); // the fresher series wins
  return [...byDay.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

async function buildSnapshot(
  query: WeatherQuery,
  windowStart: string,
  windowEnd: string,
  nowMs: number,
  fetchImpl: typeof fetch,
  tinyFish: TinyFishCallOptions | undefined,
): Promise<WeatherSnapshot> {
  const series = await fetchForecastSeries(query, windowStart, nowMs, fetchImpl);
  const sources: DataSource[] = [series.source];

  let observedDaily = series.observedDaily;
  let unitCertain = series.unitCertain;

  const reachStartDay = isoDay(nowMs + series.utcOffsetSeconds * 1000 - MAX_PAST_DAYS * 86_400_000);
  if (windowStart < reachStartDay) {
    const archive = await fetchArchiveDaily(query, windowStart, windowEnd, nowMs, fetchImpl);
    if (archive) {
      observedDaily = mergeObservedDaily(archive.daily, observedDaily);
      sources.push(archive.source);
      unitCertain = unitCertain && archive.unitCertain;
    }
  }

  const localToday = isoDay(nowMs + series.utcOffsetSeconds * 1000);
  const windowEnded = windowEnd <= localToday;

  // The window total is *only* observed days inside the window. Contra
  // rainfall, a forecast is never folded in here, and a day with no data
  // contributes nothing rather than a zero.
  const inWindow = observedDaily.filter((point) => point.at >= windowStart && point.at <= windowEnd);
  const windowTotalMm = inWindow.length > 0 ? roundMm(inWindow.reduce((sum, point) => sum + point.mm, 0)) : null;

  // If any day of the window only has forecast rainfall, the total is not a
  // measurement and may not back a claim. Normally the window has ended by the
  // time a claim is filed, so this stays false.
  const forecastInWindow = observedDaily
    .concat(series.forecastDaily)
    .some((point) => point.kind === "forecast" && point.at >= windowStart && point.at <= windowEnd);

  // The cross-check runs over the same transport the rest of the service was
  // given, so a caller that injects a fetch (tests, or a future proxy) controls
  // the TinyFish calls too rather than silently reaching for the global one.
  const crossCheck =
    query.crossCheck === false
      ? null
      : await crossCheckWithImd(query.location, windowTotalMm, nowMs, {
          fetchImpl,
          now: () => nowMs,
          ...tinyFish,
        });
  if (crossCheck) sources.push(crossCheck.source);

  const quality = assessWeatherQuality({
    latitude: query.location.latitude,
    longitude: query.location.longitude,
    observedDaily,
    observedHourly: series.observedHourly,
    forecastDaily: series.forecastDaily,
    forecastInWindow,
    observedThrough: series.observedThrough,
    windowTotalMm,
    windowEnded,
    unitCertain,
    contradiction: crossCheck?.agrees === false ? true : null,
    nowMs,
  });

  return {
    location: query.location,
    unit: "mm",
    currentMm: series.currentMm,
    todayMm: series.todayMm,
    observedHourly: series.observedHourly,
    observedDaily,
    forecastHourly: series.forecastHourly,
    forecastDaily: series.forecastDaily,
    windowTotalMm,
    window: { startDate: windowStart, endDate: windowEnd },
    timezone: series.timezone,
    observedThrough: series.observedThrough,
    sources,
    crossCheck,
    quality,
    fetchedAt: new Date(nowMs).toISOString(),
    cached: false,
  };
}

/**
 * Build a rainfall snapshot for a location over a policy window.
 *
 * The result is safe to serialise to the browser: it holds no credential, only
 * source URLs, timestamps and millimetre values.
 */
export async function getWeatherSnapshot(
  query: WeatherQuery,
  options: WeatherServiceOptions = {},
): Promise<WeatherSnapshot> {
  const now = options.now ?? Date.now;
  const nowMs = now();
  const windowStart = query.startDate ?? isoDay(nowMs);
  const windowEnd = query.endDate ?? windowStart;
  const wantCrossCheck = query.crossCheck !== false;

  const key = cacheKeyOf([
    query.location.latitude,
    query.location.longitude,
    windowStart,
    windowEnd,
    wantCrossCheck ? "x" : "-",
  ]);

  if (!options.refresh) {
    const hit = weatherCache.get(key);
    if (hit) return { ...hit.value, cached: true };
  }

  const snapshot = await buildSnapshot(
    { ...query, startDate: windowStart, endDate: windowEnd },
    windowStart,
    windowEnd,
    nowMs,
    options.fetchImpl ?? fetch,
    options.tinyFish,
  );
  weatherCache.set(key, snapshot);
  return snapshot;
}

/** Re-export so the UI can explain a rejected reading without importing internals. */
export { MAX_DAILY_MM, dailyTotalsFromHourly };
