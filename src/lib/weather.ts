import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Rainfall data from the free Open-Meteo Historical Weather API (ERA5 reanalysis,
 * no API key). Fetched server-side so the client never hits rate limits or CORS
 * quirks. The UI always shows the source and each day's timestamp.
 */
export const fetchRainfall = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    }),
  )
  .handler(async ({ data }) => {
    const url = new URL("https://archive-api.open-meteo.com/v1/archive");
    url.searchParams.set("latitude", String(data.latitude));
    url.searchParams.set("longitude", String(data.longitude));
    url.searchParams.set("start_date", data.startDate);
    url.searchParams.set("end_date", data.endDate);
    url.searchParams.set("daily", "rain_sum");
    url.searchParams.set("timezone", "auto");

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Open-Meteo request failed (${res.status})`);
    }
    const json = (await res.json()) as {
      daily?: { time?: string[]; rain_sum?: (number | null)[] };
      daily_units?: { rain_sum?: string };
      timezone?: string;
    };

    const dates = json.daily?.time ?? [];
    const amounts = json.daily?.rain_sum ?? [];
    const daily = dates.map((date, i) => ({
      date,
      mm: amounts[i] ?? 0,
    }));

    return {
      source: "Open-Meteo Historical Weather API (ERA5) — archive-api.open-meteo.com",
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: json.timezone ?? "auto",
      unit: json.daily_units?.rain_sum ?? "mm",
      daily,
      totalMm: Math.round(daily.reduce((sum, d) => sum + d.mm, 0) * 10) / 10,
      fetchedAt: new Date().toISOString(),
    };
  });

export interface RainfallReport {
  source: string;
  latitude: number;
  longitude: number;
  timezone: string;
  unit: string;
  daily: { date: string; mm: number }[];
  totalMm: number;
  fetchedAt: string;
}
