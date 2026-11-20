/**
 * Types for the live-data layer (weather oracle + mandi market prices).
 *
 * Shared with the browser, so nothing here may hold a credential. Every reading
 * carries the source it came from and the time it was observed, because an
 * un-attributed number is indistinguishable from an invented one.
 */

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

export interface DataSource {
  /** Stable id, e.g. "open-meteo-forecast" or "imd". */
  id: string;
  /** Human-readable name shown next to the reading. */
  name: string;
  /** The exact URL the value came from. */
  url: string;
  /** "api" = structured machine-readable feed; "web" = a page read by TinyFetch. */
  kind: "api" | "web";
  /** When we retrieved it (ISO 8601). */
  retrievedAt: string;
}

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

/**
 * Observed and forecast rainfall are the same unit but never the same thing:
 * only observed readings may back a payout.
 */
export type RainfallKind = "observed" | "forecast";

export interface RainfallPoint {
  /** ISO 8601 timestamp of the start of the interval (UTC). */
  at: string;
  /** Rainfall over the interval, in millimetres. */
  mm: number;
  kind: RainfallKind;
}

export interface LocationRef {
  name: string;
  latitude: number;
  longitude: number;
}

export interface WeatherQuality {
  /** True when the snapshot is usable at all. */
  ok: boolean;
  /** Machine-readable issue codes. */
  issues: WeatherIssue[];
  /**
   * True when the reported window total includes forecast rainfall. A forecast
   * may be shown next to the observation, but it disqualifies the total as a
   * claim — which is why this is about the window, not about the snapshot.
   */
  containsForecast: boolean;
  /** True when the reading is complete enough to back a contractual report. */
  claimGrade: boolean;
}

export type WeatherIssue =
  | "no-data"
  | "stale"
  | "implausible-rainfall"
  | "unit-uncertain"
  | "contradictory-sources"
  | "forecast-only"
  | "forecast-in-window"
  | "window-not-ended"
  | "out-of-range-coordinates";

export interface SourceCrossCheck {
  source: DataSource;
  /** Rainfall the other source states, in mm, when it could be read. */
  mm: number | null;
  /** Whether it agrees with the primary series within tolerance. */
  agrees: boolean | null;
  note: string;
}

export interface WeatherSnapshot {
  location: LocationRef;
  /** Always millimetres; the gateway of record for rainfall in this app. */
  unit: "mm";
  /** Most recent observed hour. */
  currentMm: number | null;
  /** Observed rainfall accumulated so far today (in the series timezone). */
  todayMm: number | null;
  observedHourly: RainfallPoint[];
  observedDaily: RainfallPoint[];
  forecastHourly: RainfallPoint[];
  forecastDaily: RainfallPoint[];
  /**
   * Observed rainfall totalled across the requested window. This is the only
   * value that may be submitted to the insurance contract.
   */
  windowTotalMm: number | null;
  window: { startDate: string; endDate: string } | null;
  timezone: string;
  /** Latest observation timestamp present in the observed series. */
  observedThrough: string | null;
  sources: DataSource[];
  crossCheck: SourceCrossCheck | null;
  quality: WeatherQuality;
  fetchedAt: string;
  cached: boolean;
}

// ---------------------------------------------------------------------------
// Mandi market prices
// ---------------------------------------------------------------------------

export interface MandiPrice {
  /** The crop/commodity name as reported by the source. */
  crop: string;
  state: string | null;
  district: string | null;
  /** Mandi/market name. */
  market: string | null;
  minInr: number | null;
  maxInr: number | null;
  /** Modal (most-traded) price. The headline figure. */
  modalInr: number | null;
  /** Always normalised to INR per quintal (100 kg). */
  unit: "INR/quintal";
  /** Market date as reported, YYYY-MM-DD when it could be parsed. */
  priceDate: string | null;
  /** When the source last updated the row, as reported. */
  updatedAt: string | null;
  source: DataSource;
}

export interface MandiPrices {
  crop: string;
  state: string | null;
  district: string | null;
  /**
   * False when no source yielded a usable row. The UI must then render
   * "Data unavailable" — a price is never inferred, interpolated or guessed.
   */
  available: boolean;
  /** Why nothing was available, when available is false. */
  reason: string | null;
  latest: MandiPrice | null;
  previous: MandiPrice | null;
  changePercent: number | null;
  history: MandiPrice[];
  sources: DataSource[];
  queriedAt: string;
  cached: boolean;
}

/** A crop the market module knows how to ask for. */
export interface CropOption {
  name: string;
  /** Query aliases used when searching, because sources spell crops differently. */
  aliases: string[];
}

// ---------------------------------------------------------------------------
// Live-data configuration (non-secret)
// ---------------------------------------------------------------------------

export interface LiveDataConfig {
  /** True when the server holds a TinyFish API key. */
  tinyfishConfigured: boolean;
  /** Variable names (never values) the server is missing. */
  missing: string[];
  weather: {
    /** Structured rainfall provider; always available (no key required). */
    provider: "open-meteo";
    /** True when TinyFish can be used to cross-check against IMD. */
    crossCheckEnabled: boolean;
  };
  market: {
    provider: "tinyfish";
    enabled: boolean;
  };
  /** True when the server can submit an oracle report on-chain. */
  oracleReporting: {
    enabled: boolean;
    missing: string[];
  };
  crops: string[];
}
