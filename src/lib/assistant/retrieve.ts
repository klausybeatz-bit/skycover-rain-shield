/**
 * Grounding retrieval for the farmer assistant.
 *
 * The assistant may only answer from what this module returns: curated
 * SkyCover facts (./knowledge.ts), a live reading from the existing weather or
 * mandi oracle, or a cited web result read with TinyFish. Anything it cannot
 * ground stays unanswerable, which is the point — a farming decision is no
 * place for a plausible guess.
 */

import { CROP_OPTIONS } from "../oracle/crops";
import { getMandiPrices } from "../oracle/market";
import type { DataSource, MandiPrice, MandiPrices, WeatherSnapshot } from "../oracle/types";
import { getWeatherSnapshot } from "../oracle/weather";
import { tinyFetch, tinySearch } from "../tinyfish/client";
import { describeTinyFishFailure, TinyFishError } from "../tinyfish/types";
import type { AnswerSource, AssistantLocation } from "./types";

export interface ContextBlock {
  title: string;
  body: string;
}

export interface RetrievedContext {
  blocks: ContextBlock[];
  sources: AnswerSource[];
  origin: "live" | "web" | "none";
  /** Set when a lookup was attempted but could not complete. */
  note: string | null;
}

export interface RetrieveOptions {
  /** Injected for tests; defaults to the runtime fetch. */
  fetchImpl?: typeof fetch;
}

const RAIN_WORDS = ["rain", "rainfall", "barish", "barsaat", "monsoon", "precipitation"];
const PRICE_WORDS = ["price", "mandi", "market rate", "msp", "quintal", "sell my", "selling"];

const MAX_WEB_RESULTS = 5;
const MAX_FETCH_CHARS = 2000;

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function transport(options: RetrieveOptions): RetrieveOptions {
  return options.fetchImpl ? { fetchImpl: options.fetchImpl } : {};
}

export function asksAboutRain(question: string): boolean {
  const q = normalise(question);
  return RAIN_WORDS.some((word) => q.includes(word));
}

export function asksAboutPrice(question: string): boolean {
  const q = normalise(question);
  return PRICE_WORDS.some((word) => q.includes(word));
}

/** The canonical crop named in the question, if any. */
export function mentionedCrop(question: string): string | null {
  const q = normalise(question);
  for (const crop of CROP_OPTIONS) {
    if (crop.aliases.some((alias) => q.includes(normalise(alias)))) return crop.name;
  }
  return null;
}

function mm(value: number | null): string {
  return value === null ? "not available" : `${value} mm`;
}

function inr(value: number | null): string {
  return value === null ? "not available" : `₹${value.toLocaleString("en-IN")}`;
}

function joinNotes(...parts: ReadonlyArray<string | null>): string | null {
  const kept = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return kept.length > 0 ? kept.join(" ") : null;
}

function liveSource(source: DataSource, observedAt: string | null): AnswerSource {
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    kind: "live",
    observedAt: observedAt ?? source.retrievedAt,
  };
}

function describeWeather(snapshot: WeatherSnapshot): string {
  const lines: string[] = [];
  if (snapshot.window) {
    const grade = snapshot.quality.claimGrade ? "" : " (not claim-grade)";
    lines.push(
      `Observed total for ${snapshot.window.startDate} to ${snapshot.window.endDate}: ${mm(snapshot.windowTotalMm)}${grade}.`,
    );
  }
  lines.push(
    `Today (${snapshot.timezone}): ${mm(snapshot.todayMm)}. Current hour: ${mm(snapshot.currentMm)}.`,
  );
  if (snapshot.observedThrough) lines.push(`Latest observation: ${snapshot.observedThrough}.`);
  const forecast = snapshot.forecastDaily
    .slice(0, 3)
    .map((point) => `${point.at.slice(0, 10)}: ${point.mm} mm`)
    .join("; ");
  if (forecast.length > 0) lines.push(`Forecast (never used for a claim): ${forecast}.`);
  return lines.join(" ");
}

function describeMandi(result: MandiPrices, latest: MandiPrice): string {
  const where =
    [latest.market, latest.district, latest.state].filter(Boolean).join(", ") ||
    "location not stated";
  const lines = [
    `Modal price ${inr(latest.modalInr)} per quintal (min ${inr(latest.minInr)}, max ${inr(latest.maxInr)}).`,
  ];
  if (latest.priceDate) lines.push(`Market date ${latest.priceDate}.`);
  lines.push(`Market: ${where}.`);
  if (result.changePercent !== null) {
    lines.push(
      `Change vs previous: ${result.changePercent > 0 ? "+" : ""}${result.changePercent}%.`,
    );
  }
  return lines.join(" ");
}

/** Live rainfall and/or mandi price, straight from the existing oracle modules. */
export async function retrieveLive(
  question: string,
  location: AssistantLocation | null,
  options: RetrieveOptions = {},
): Promise<RetrievedContext> {
  const blocks: ContextBlock[] = [];
  const sources: AnswerSource[] = [];
  let note: string | null = null;
  const svc = transport(options);

  if (asksAboutRain(question)) {
    if (!location) {
      note = joinNotes(
        note,
        "No location is set, so live rainfall cannot be looked up. Choose a location and ask again.",
      );
    } else {
      try {
        const snapshot = await getWeatherSnapshot({ location, crossCheck: true }, svc);
        blocks.push({
          title: `Observed rainfall — ${snapshot.location.name}`,
          body: describeWeather(snapshot),
        });
        for (const source of snapshot.sources) {
          sources.push(liveSource(source, snapshot.observedThrough));
        }
      } catch (error) {
        note = joinNotes(
          note,
          error instanceof Error ? error.message : "Observed rainfall could not be retrieved.",
        );
      }
    }
  }

  if (asksAboutPrice(question)) {
    const crop = mentionedCrop(question);
    if (!crop) {
      note = joinNotes(note, "No crop was named, so no mandi price could be looked up.");
    } else {
      try {
        const result = await getMandiPrices({ crop }, svc);
        if (result.available && result.latest) {
          blocks.push({
            title: `Mandi price — ${crop}`,
            body: describeMandi(result, result.latest),
          });
          for (const source of result.sources) {
            sources.push(liveSource(source, result.latest.updatedAt ?? result.queriedAt));
          }
        } else {
          note = joinNotes(note, result.reason ?? `No usable mandi price was found for ${crop}.`);
        }
      } catch (error) {
        note = joinNotes(
          note,
          error instanceof Error ? error.message : "Mandi prices could not be retrieved.",
        );
      }
    }
  }

  return { blocks, sources, origin: blocks.length > 0 ? "live" : "none", note };
}

/** Cited web results for questions the curated base does not cover. */
export async function retrieveWeb(
  question: string,
  options: RetrieveOptions = {},
): Promise<RetrievedContext> {
  const query = question.trim();
  if (query.length === 0) return { blocks: [], sources: [], origin: "none", note: null };
  const svc = transport(options);

  try {
    const search = await tinySearch(
      {
        query,
        purpose:
          "Answer an Indian farmer's question about crops, weather or crop insurance from authoritative sources.",
        location: "IN",
        language: "en",
        domainType: "web",
      },
      svc,
    );

    const results = search.results.slice(0, MAX_WEB_RESULTS);
    if (results.length === 0) {
      return {
        blocks: [],
        sources: [],
        origin: "none",
        note: "No sources were found for that question.",
      };
    }

    const blocks: ContextBlock[] = results.map((result) => ({
      title: result.title,
      body: result.snippet,
    }));
    const sources: AnswerSource[] = results.map((result) => ({
      id: result.url,
      name: result.site_name || result.url,
      url: result.url,
      kind: "web",
      observedAt: result.date ?? null,
    }));

    const top = results[0];
    if (top) {
      try {
        const fetched = await tinyFetch(
          {
            urls: [top.url],
            purpose: "Extract the article text that answers the farmer's question.",
            format: "markdown",
          },
          svc,
        );
        const text = fetched.results[0]?.text;
        if (typeof text === "string" && text.trim().length > 0) {
          blocks.push({ title: `${top.title} (full text)`, body: text.slice(0, MAX_FETCH_CHARS) });
        }
      } catch {
        // The snippet is still usable; a failed fetch is never fatal.
      }
    }

    return { blocks, sources, origin: "web", note: null };
  } catch (error) {
    const note =
      error instanceof TinyFishError
        ? describeTinyFishFailure(error)
        : error instanceof Error
          ? error.message
          : "Web sources could not be retrieved.";
    return { blocks: [], sources: [], origin: "none", note };
  }
}
