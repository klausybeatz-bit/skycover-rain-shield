/**
 * Live mandi market prices.
 *
 * Prices are discovered with TinySearch and read with TinyFetch, then parsed by
 * a deterministic table reader — never by a model. The parser only accepts a row
 * that states a price with a determinable unit; anything else is reported as
 * unavailable rather than guessed, because a fabricated mandi price is worse
 * than no price.
 *
 * Market prices are shown to the user only. They are never an input to a
 * rainfall claim: see reportableWindow in ./trust.ts, which rejects any value
 * that did not come from the rainfall series.
 *
 * This module must only be imported from server code paths.
 */

import { cacheKeyOf, TtlCache } from "../tinyfish/cache";
import { tinyFetch, tinySearch, type TinyFishCallOptions } from "../tinyfish/client";
import { describeTinyFishFailure, TinyFishError } from "../tinyfish/types";
import { aliasesFor } from "./crops";
import type { DataSource, MandiPrice, MandiPrices } from "./types";
import { parseNumericCell, parsePriceUnit, roundTo, toInrPerQuintal, type PriceUnit } from "./units";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Mandi prices change at most daily, so a longer TTL is safe and saves calls. */
const MARKET_CACHE_TTL_MS = 30 * 60 * 1000;
const marketCache = new TtlCache<MandiPrices>({ ttlMs: MARKET_CACHE_TTL_MS, maxEntries: 200 });

export function clearMarketCache(): void {
  marketCache.clear();
}

// ---------------------------------------------------------------------------
// Query / options
// ---------------------------------------------------------------------------

export interface MarketQuery {
  crop: string;
  state?: string;
  district?: string;
  market?: string;
}

export interface MarketServiceOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  tinyFish?: TinyFishCallOptions;
  refresh?: boolean;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/** Domains whose unit convention is a fixed INR/quintal. */
const OFFICIAL_MANDI_SOURCES = [
  /agmarknet\.gov\.in/i,
  /enam\.gov\.in/i,
  /data\.gov\.in/i,
  /agriwelfare\.gov\.in/i,
  /agmarknet\.[a-z.]+/i,
];

/** Domains preferred when ranking search results. */
const PREFERRED_DOMAINS = [
  /agmarknet\.gov\.in/i,
  /enam\.gov\.in/i,
  /data\.gov\.in/i,
  /agriwelfare\.gov\.in/i,
  /\.gov\.in$/i,
  /\.nic\.in$/i,
];

const MAX_FETCH_TARGETS = 3;

function isOfficial(url: string): boolean {
  return OFFICIAL_MANDI_SOURCES.some((pattern) => pattern.test(url));
}

function rankResults<T extends { url: string }>(results: ReadonlyArray<T>): T[] {
  return [...results].sort((a, b) => rank(a.url) - rank(b.url));
}

function rank(url: string): number {
  const index = PREFERRED_DOMAINS.findIndex((pattern) => pattern.test(url));
  return index === -1 ? PREFERRED_DOMAINS.length : index;
}

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

interface ColumnMap {
  commodity?: number;
  state?: number;
  district?: number;
  market?: number;
  min?: number;
  max?: number;
  modal?: number;
  date?: number;
}

const DATE_LIKE = /\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}/;

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) {
    return trimmed.split(/\t+|\s{2,}/).map((cell) => cell.trim()).filter(Boolean);
  }
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function findHeader(lines: ReadonlyArray<string>): { index: number; map: ColumnMap } | null {
  const limit = Math.min(lines.length, 80);
  for (let i = 0; i < limit; i += 1) {
    const cells = splitRow(lines[i]!);
    if (cells.length < 4) continue;
    const lower = cells.map((cell) => cell.toLowerCase());
    const hasCommodity = lower.some((cell) => /commodity|crop|item/.test(cell));
    const hasPrice = lower.some((cell) => /modal|price/.test(cell));
    if (!hasCommodity || !hasPrice) continue;

    const map: ColumnMap = {};
    lower.forEach((cell, index) => {
      if (map.commodity === undefined && /commodity|crop|item/.test(cell)) map.commodity = index;
      else if (map.state === undefined && /state/.test(cell)) map.state = index;
      else if (map.district === undefined && /district/.test(cell)) map.district = index;
      else if (map.market === undefined && /market|mandi|centre|center/.test(cell)) map.market = index;
      else if (map.min === undefined && /\bmin/.test(cell)) map.min = index;
      else if (map.max === undefined && /\bmax/.test(cell)) map.max = index;
      else if (map.modal === undefined && /modal/.test(cell)) map.modal = index;
      else if (map.date === undefined && /date|updated|arrival/.test(cell)) map.date = index;
    });
    return { index: i, map };
  }
  return null;
}

function normaliseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const numeric = text.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (numeric) {
    let day = Number.parseInt(numeric[1]!, 10);
    let month = Number.parseInt(numeric[2]!, 10);
    let year = Number.parseInt(numeric[3]!, 10);
    // Indian mandi sources publish day-first. The only swap that is not a guess
    // is when day-first is impossible.
    if (month > 12 && day <= 12) {
      [day, month] = [month, day];
    }
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const worded = text.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (worded) {
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = months.indexOf(worded[2]!.slice(0, 3).toLowerCase()) + 1;
    if (month > 0) {
      return `${worded[3]}-${String(month).padStart(2, "0")}-${String(Number.parseInt(worded[1]!, 10)).padStart(2, "0")}`;
    }
  }
  return null;
}

/** Find an explicit unit statement anywhere on the page. */
function detectUnitText(text: string): string | null {
  const match = text.match(/per\s*(quintal|qtl|tonne|metric\s*ton|mt|kg|kilogram)|\b(quintal|qtl|tonne|mt)\b/i);
  return match ? match[0] : null;
}

interface RowContext {
  query: MarketQuery;
  source: DataSource;
  unit: PriceUnit;
}

function buildPrice(cells: ReadonlyArray<string>, map: ColumnMap | undefined, context: RowContext): MandiPrice | null {
  const pick = (index?: number): string | undefined => (index === undefined ? undefined : cells[index]);

  const commodity = (map?.commodity !== undefined ? pick(map.commodity) : cells.find((cell) => matchesCrop(cell, context.query.crop))) ?? "";

  let minRaw: string | undefined;
  let maxRaw: string | undefined;
  let modalRaw: string | undefined;

  if (map && (map.min !== undefined || map.max !== undefined || map.modal !== undefined)) {
    minRaw = pick(map.min);
    maxRaw = pick(map.max);
    modalRaw = pick(map.modal);
  } else {
    // No usable header: fall back to positional numbers, AGMARKNET order
    // (min, max, modal). Dates and the commodity cell are excluded first.
    const numbers = cells.filter(
      (cell) => !DATE_LIKE.test(cell) && !matchesCrop(cell, context.query.crop) && parseNumericCell(cell) !== null,
    );
    [minRaw, maxRaw, modalRaw] = numbers;
  }

  const toQuintals = (raw: string | undefined): number | null => {
    const value = raw === undefined ? null : parseNumericCell(raw);
    if (value === null) return null;
    return toInrPerQuintal(value, context.unit);
  };

  const minInr = toQuintals(minRaw);
  const maxInr = toQuintals(maxRaw);
  const modalInr = toQuintals(modalRaw);

  // A row with no usable price at all is not a price row.
  if (minInr === null && maxInr === null && modalInr === null) return null;
  // A modal price is the headline; derive it from the bounds only if it is
  // missing, and only when both bounds are present (never invented from one).
  const modal = modalInr ?? (minInr !== null && maxInr !== null ? roundTo((minInr + maxInr) / 2, 2) : null);

  const dateCell = map?.date !== undefined ? pick(map.date) : cells.find((cell) => DATE_LIKE.test(cell));

  return {
    crop: commodity || context.query.crop,
    state: (map?.state !== undefined ? pick(map.state) : null) || context.query.state || null,
    district: (map?.district !== undefined ? pick(map.district) : null) || context.query.district || null,
    market: (map?.market !== undefined ? pick(map.market) : null) || context.query.market || null,
    minInr,
    maxInr,
    modalInr: modal,
    unit: "INR/quintal",
    priceDate: normaliseDate(typeof dateCell === "string" ? dateCell : undefined),
    updatedAt: null,
    source: context.source,
  };
}

function matchesCrop(cell: string, crop: string): boolean {
  const aliases = aliasesFor(crop);
  const lower = cell.toLowerCase();
  return aliases.some((alias) => lower.includes(alias.toLowerCase()));
}

/** Extract every usable price row from one retrieved page. */
export function parseMandiPage(
  markdown: string,
  context: { query: MarketQuery; source: DataSource; pageText?: string },
): MandiPrice[] {
  const lines = markdown.split(/\r?\n/);
  const header = findHeader(lines);

  // An official source states prices in INR per quintal; anything else must say
  // so on the page, otherwise the figure cannot be normalised and is dropped.
  const explicit = detectUnitText(context.pageText ?? markdown);
  const unit = (explicit ? parsePriceUnit(explicit) : null) ?? (isOfficial(context.source.url) ? "quintal" : null);
  if (!unit) return [];

  const rowContext: RowContext = { query: context.query, source: context.source, unit };

  const rows: MandiPrice[] = [];
  const seen = new Set<string>();
  const start = header ? header.index + 1 : 0;
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.includes("|") && !/\t/.test(line)) continue;
    const cells = splitRow(line);
    if (cells.length < 3) continue;
    if (cells.every((cell) => /^[-:\s]*$/.test(cell))) continue;

    const price = buildPrice(cells, header?.map, rowContext);
    if (!price) continue;

    const fingerprint = [price.market, price.district, price.priceDate, price.modalInr].join("|");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    rows.push(price);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function emptyResult(query: MarketQuery, reason: string, nowMs: number): MandiPrices {
  return {
    crop: query.crop,
    state: query.state ?? null,
    district: query.district ?? null,
    available: false,
    reason,
    latest: null,
    previous: null,
    changePercent: null,
    history: [],
    sources: [],
    queriedAt: new Date(nowMs).toISOString(),
    cached: false,
  };
}

function sortByDateDesc(rows: ReadonlyArray<MandiPrice>): MandiPrice[] {
  return [...rows].sort((a, b) => {
    const left = a.priceDate ?? "";
    const right = b.priceDate ?? "";
    if (left === right) return 0;
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? 1 : -1;
  });
}

function changePercent(latest: MandiPrice, previous: MandiPrice): number | null {
  if (latest.modalInr === null || previous.modalInr === null) return null;
  if (previous.modalInr === 0) return null;
  return roundTo(((latest.modalInr - previous.modalInr) / previous.modalInr) * 100, 2);
}

function buildSearchQuery(query: MarketQuery): string {
  const where = [query.market, query.district, query.state].filter(Boolean).join(" ");
  return `AGMARKNET mandi daily price ${query.crop} modal price per quintal ${where} today`;
}

export async function getMandiPrices(
  query: MarketQuery,
  options: MarketServiceOptions = {},
): Promise<MandiPrices> {
  const now = options.now ?? Date.now;
  const nowMs = now();
  const crop = query.crop.trim();
  if (crop.length === 0) return emptyResult(query, "No crop was selected.", nowMs);

  const key = cacheKeyOf([crop, query.state, query.district, query.market]);
  if (!options.refresh) {
    const hit = marketCache.get(key);
    if (hit) return { ...hit.value, cached: true };
  }

  let result: MandiPrices;
  try {
    const search = await tinySearch(
      {
        query: buildSearchQuery({ ...query, crop }),
        purpose:
          "Find the current official Indian mandi (AGRISNET/AGMARKNET/eNAM) price for a crop so a farmer can be shown today's modal price.",
        location: "IN",
        language: "en",
        domainType: "web",
        recencyMinutes: 7 * 24 * 60,
      },
      options.tinyFish,
    );

    const candidates = rankResults(search.results).slice(0, MAX_FETCH_TARGETS);
    if (candidates.length === 0) {
      result = emptyResult({ ...query, crop }, "No market data source was found for this crop.", nowMs);
    } else {
      const fetched = await tinyFetch(
        {
          urls: candidates.map((candidate) => candidate.url),
          format: "markdown",
          purpose: `Extract the min, max and modal mandi price in INR per quintal for ${crop}.`,
        },
        options.tinyFish,
      );

      const sources: DataSource[] = [];
      const rows: MandiPrice[] = [];
      for (const page of fetched.results) {
        const source: DataSource = {
          id: isOfficial(page.final_url || page.url) ? "agmarknet" : "mandi-web",
          name: new URL(page.final_url || page.url).hostname,
          url: page.final_url || page.url,
          kind: "web",
          retrievedAt: new Date(nowMs).toISOString(),
        };
        sources.push(source);
        const text = typeof page.text === "string" ? page.text : "";
        rows.push(...parseMandiPage(text, { query: { ...query, crop }, source }));
      }

      if (rows.length === 0) {
        result = {
          ...emptyResult(
            { ...query, crop },
            `Data unavailable — ${fetched.results.length} source${
              fetched.results.length === 1 ? "" : "s"
            } were retrieved but none stated a usable price in a known unit.`,
            nowMs,
          ),
          sources,
        };
      } else {
        const ordered = sortByDateDesc(rows);
        const latest = ordered[0]!;
        const previous = ordered.find((row) => row.priceDate !== latest.priceDate) ?? ordered[1] ?? null;
        result = {
          crop,
          state: query.state ?? latest.state,
          district: query.district ?? latest.district,
          available: true,
          reason: null,
          latest,
          previous,
          changePercent: previous ? changePercent(latest, previous) : null,
          history: ordered,
          sources,
          queriedAt: new Date(nowMs).toISOString(),
          cached: false,
        };
      }
    }
  } catch (error) {
    if (error instanceof TinyFishError) {
      result = emptyResult({ ...query, crop }, describeTinyFishFailure(error), nowMs);
    } else {
      result = emptyResult({ ...query, crop }, "Live market data could not be retrieved.", nowMs);
    }
  }

  marketCache.set(key, result);
  return result;
}
