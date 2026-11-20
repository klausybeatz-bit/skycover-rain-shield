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
  /** Null when no webhook signing secret is configured. Server-only. */
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

  // The key pair is what live checkout needs: it authenticates the outbound
  // Orders/Payments calls and it is the secret behind the checkout signature.
  // A settled payment is therefore always proved twice — the HMAC over
  // `${order_id}|${payment_id}` and a read of the gateway's own Payments API —
  // so a forged redirect cannot activate a policy even with no webhook.
  //
  // The webhook secret is deliberately *not* part of this gate. It buys a
  // second, out-of-band confirmation channel (and reconciliation when a buyer
  // closes the browser before the callback fires), not authenticity. Requiring
  // it to switch on live mode would take the checkout down for a buyer whose
  // payment is still perfectly verifiable.
  const live = !forcedDemo && missing.length === 0;

  return {
    provider: live ? "razorpay" : "none",
    mode: live ? "live" : "simulated",
    keyId: live ? keyId : null,
    keySecret: live ? keySecret : null,
    // Kept as read, so the webhook endpoint can tell "no signing secret" apart
    // from "live mode is off". Never leaves the server.
    webhookSecret,
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
    testMode: isTestKey(config.keyId),
    liveModeMissing: liveModeMissing(config),
  };
}

/**
 * Razorpay test keys are publishable and prefixed `rzp_test_`; live keys use
 * `rzp_live_`. Reading the prefix is therefore safe, and it is the only signal
 * available at runtime that tells the UI whether a payment was made in the
 * gateway's test environment. Unknown formats are treated as live (not test),
 * so a label is never applied that has not been earned.
 */
function isTestKey(keyId: string | null): boolean {
  return typeof keyId === "string" && keyId.startsWith("rzp_test_");
}
