/**
 * Server-only UPI gateway configuration.
 *
 * Every secret is read from `process.env` at call time — never at module load —
 * and this module is only reached from server function handlers, the webhook
 * handler, or the server entry. Secrets are never returned to the browser: see
 * `getPublicUpiConfig()`, which intentionally exposes only the publishable key
 * id plus the *names* of any missing variables.
 */

import { DEFAULT_INR_PER_ETH, UPI_WEBHOOK_PATH, type UpiConfigView, type UpiMode } from "./types";

function readEnv(name: string): string | undefined {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : undefined;
}

export interface UpiServerConfig {
  provider: "razorpay" | "none";
  mode: UpiMode;
  keyId: string | null;
  keySecret: string | null;
  webhookSecret: string | null;
  inrPerEth: number;
  /** Names (never values) of the variables that keep live mode switched off. */
  missing: string[];
  /** Reason live mode was disabled even though credentials are present. */
  forcedDemo: boolean;
}

function readInrPerEth(): number {
  const parsed = Number.parseFloat(readEnv("UPI_INR_PER_ETH") ?? "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INR_PER_ETH;
}

export function getUpiServerConfig(): UpiServerConfig {
  const keyId = readEnv("RAZORPAY_KEY_ID") ?? null;
  const keySecret = readEnv("RAZORPAY_KEY_SECRET") ?? null;
  const webhookSecret = readEnv("RAZORPAY_WEBHOOK_SECRET") ?? null;
  const forcedDemo = readEnv("UPI_DEMO_MODE")?.toLowerCase() === "true";

  const missing: string[] = [];
  if (!keyId) missing.push("RAZORPAY_KEY_ID");
  if (!keySecret) missing.push("RAZORPAY_KEY_SECRET");
  if (!webhookSecret) missing.push("RAZORPAY_WEBHOOK_SECRET");

  // Live mode requires all three: the key pair authenticates outbound API
  // calls, and the webhook secret is what makes inbound notifications
  // trustworthy. Without the webhook secret a redirect could be forged.
  const live = !forcedDemo && missing.length === 0;

  return {
    provider: live ? "razorpay" : "none",
    mode: live ? "live" : "simulated",
    keyId: live ? keyId : null,
    keySecret: live ? keySecret : null,
    webhookSecret: live ? webhookSecret : null,
    inrPerEth: readInrPerEth(),
    missing,
    forcedDemo,
  };
}

/** Why live mode is off, as variable *names* only — never their values. */
export function liveModeMissing(config: UpiServerConfig): string[] {
  return config.forcedDemo ? ["UPI_DEMO_MODE=true"] : config.missing;
}

/** The subset of configuration that is safe to send to the browser. */
export function getPublicUpiConfig(): UpiConfigView {
  const config = getUpiServerConfig();
  return {
    mode: config.mode,
    provider: config.provider,
    publicKeyId: config.keyId,
    inrPerEth: config.inrPerEth,
    webhookPath: UPI_WEBHOOK_PATH,
    liveModeMissing: liveModeMissing(config),
  };
}
