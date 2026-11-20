/**
 * Server functions backing the Live Data dashboard.
 *
 * Everything here runs on the server. The browser can ask for a rainfall
 * snapshot, a set of mandi prices, and the non-secret configuration view — it
 * can never obtain the TinyFish key, the oracle signing key, or a way to submit
 * a report that bypasses ./trust.ts.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getTinyFishConfig } from "../tinyfish/config";
import { listCrops } from "./crops";
import { getMandiPrices } from "./market";
import { getOracleReportConfig, submitOracleReport, type OracleReportOutcome } from "./trust";
import type { LiveDataConfig, MandiPrices, WeatherSnapshot } from "./types";
import { getWeatherSnapshot, WeatherUnavailableError } from "./weather";

const locationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const daySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type WeatherResult =
  | { ok: true; snapshot: WeatherSnapshot }
  | { ok: false; reason: string };

/**
 * Public, non-secret view of what live data this deployment can reach. It
 * reports *names* of unset variables, never their values, so the UI can show an
 * honest "not configured" state instead of a fabricated one.
 */
export const getLiveDataConfig = createServerFn({ method: "GET" }).handler(
  async (): Promise<LiveDataConfig> => {
    const tinyfish = getTinyFishConfig();
    const oracle = getOracleReportConfig();
    return {
      tinyfishConfigured: tinyfish.enabled,
      missing: tinyfish.missing,
      weather: { provider: "open-meteo", crossCheckEnabled: tinyfish.enabled },
      market: { provider: "tinyfish", enabled: tinyfish.enabled },
      oracleReporting: { enabled: oracle.enabled, missing: oracle.missing },
      crops: listCrops(),
    };
  },
);

/**
 * Observed rainfall for a location and window, plus the forecast alongside it.
 * Forecast values are returned separately and never folded into `windowTotalMm`.
 */
export const fetchWeatherOracle = createServerFn({ method: "GET" })
  .validator(
    z.object({
      location: locationSchema,
      startDate: daySchema.optional(),
      endDate: daySchema.optional(),
      crossCheck: z.boolean().optional(),
      refresh: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<WeatherResult> => {
    try {
      const query: Parameters<typeof getWeatherSnapshot>[0] = { location: data.location };
      if (data.startDate !== undefined) query.startDate = data.startDate;
      if (data.endDate !== undefined) query.endDate = data.endDate;
      if (data.crossCheck !== undefined) query.crossCheck = data.crossCheck;

      const snapshot = await getWeatherSnapshot(query, data.refresh === true ? { refresh: true } : {});
      return { ok: true, snapshot };
    } catch (error) {
      const reason =
        error instanceof WeatherUnavailableError
          ? error.message
          : "Live rainfall data could not be retrieved right now.";
      return { ok: false, reason };
    }
  });

/** Latest available mandi prices for a crop. Never infers a missing price. */
export const fetchMandiPrices = createServerFn({ method: "GET" })
  .validator(
    z.object({
      crop: z.string().trim().min(1).max(60),
      state: z.string().trim().min(1).max(60).optional(),
      district: z.string().trim().min(1).max(60).optional(),
      market: z.string().trim().min(1).max(60).optional(),
      refresh: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<MandiPrices> => {
    const query: Parameters<typeof getMandiPrices>[0] = { crop: data.crop };
    if (data.state !== undefined) query.state = data.state;
    if (data.district !== undefined) query.district = data.district;
    if (data.market !== undefined) query.market = data.market;

    return getMandiPrices(query, data.refresh === true ? { refresh: true } : {});
  });

/**
 * Report a verified rainfall total for a policy on-chain.
 *
 * The reading is re-fetched server-side and checked against the policy's own
 * location and window by ./trust.ts; the caller cannot supply the millimetre
 * value, so an unverified number can never be submitted.
 */
export const submitWeatherReport = createServerFn({ method: "POST" })
  .validator(
    z.object({
      policyId: z.number().int().nonnegative(),
      location: locationSchema,
      startDate: daySchema,
      endDate: daySchema,
    }),
  )
  .handler(async ({ data }): Promise<OracleReportOutcome> => {
    const snapshot = await getWeatherSnapshot(
      { location: data.location, startDate: data.startDate, endDate: data.endDate },
      { refresh: true },
    );
    return submitOracleReport({
      policyId: data.policyId,
      snapshot,
      expected: {
        startDate: data.startDate,
        endDate: data.endDate,
        latitude: data.location.latitude,
        longitude: data.location.longitude,
      },
    });
  });
