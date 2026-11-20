/**
 * Server-only TinyFish configuration.
 *
 * The API key is read from the environment at call time (never at module load)
 * and is only ever handed to ./client.ts, which puts it in an `X-API-Key`
 * header on a server-side request. It is never returned to the browser: see
 * getPublicLiveDataConfig() in ../oracle/server-fns.ts, which exposes only
 * booleans and the *names* of anything missing.
 */

export interface TinyFishConfig {
  /** The API key, or null when the server has none. Never crosses to the client. */
  apiKey: string | null;
  /** True when live TinyFish calls can be attempted at all. */
  enabled: boolean;
  /** Variable *names* that are unset. Never values. */
  missing: string[];
  /** Requests per minute this server allows itself. */
  rateLimitPerMinute: number;
}

export const TINYFISH_API_KEY_VAR = "TINYFISH_API_KEY";

function readEnv(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : undefined;
}

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(readEnv(name) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * TinyFish allows 30 requests/minute on personal accounts. We default to 20 so
 * SkyCover stays comfortably under the ceiling even when a page load triggers
 * a weather and a market lookup back to back.
 */
const DEFAULT_RATE_LIMIT_PER_MINUTE = 20;

export function getTinyFishConfig(): TinyFishConfig {
  const apiKey = readEnv(TINYFISH_API_KEY_VAR) ?? null;
  const missing: string[] = [];
  if (!apiKey) missing.push(TINYFISH_API_KEY_VAR);

  return {
    apiKey,
    enabled: apiKey !== null,
    missing,
    rateLimitPerMinute: readPositiveInt(
      "TINYFISH_RATE_LIMIT_PER_MINUTE",
      DEFAULT_RATE_LIMIT_PER_MINUTE,
    ),
  };
}
