/**
 * UPI payment types shared between the browser and the server.
 *
 * Nothing in this file may contain a secret: it is imported by client
 * components. Gateway keys live in src/lib/upi/server-config.ts, which is only
 * ever reached from a server-only code path.
 */

/** Public path the payment gateway posts webhooks to. */
export const UPI_WEBHOOK_PATH = "/api/upi/webhook";

/**
 * Conversion rate used to price the INR-denominated premium.
 *
 * This is a FIXED product configuration value, not a live exchange rate — this
 * prototype has no FX price feed, so the rate is deliberately hard-coded and
 * the UI always shows the ETH premium alongside the INR charge.
 */
export const DEFAULT_INR_PER_ETH = 250_000;

/** A policy the customer has configured but not yet paid for. */
export interface PolicyDraft {
  locationName: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  thresholdMm: number;
  coverageEth: number;
  premiumEth: number;
}

export type UpiOrderStatus = "pending" | "paid" | "failed";

/**
 * How a payment was proven. `simulated` is the only value that does not come
 * from a cryptographic check against the gateway.
 */
export type UpiVerification = "checkout_signature" | "gateway_api" | "webhook" | "simulated";

/** What the browser is allowed to know about an order. */
export interface UpiOrderView {
  orderId: string;
  status: UpiOrderStatus;
  amountInr: number;
  amountEth: number;
  currency: "INR";
  mode: UpiMode;
  policyDraft: PolicyDraft;
  /** Gateway payment id, only present once verified. */
  paymentRef: string | null;
  verification: UpiVerification | null;
  simulated: boolean;
  paidAt: number | null;
  gatewayOrderId: string | null;
  /** Set when a verification attempt failed, for customer-facing messaging. */
  failureReason: string | null;
}

export type UpiMode = "live" | "simulated";

/** Public, non-secret configuration the UI needs to render the right flow. */
export interface UpiConfigView {
  mode: UpiMode;
  provider: "razorpay" | "none";
  /**
   * Publishable gateway key id. This is the only gateway credential that is
   * allowed near the browser, and it is safe to expose by design.
   */
  publicKeyId: string | null;
  inrPerEth: number;
  webhookPath: string;
  /** Why live mode is off, so the UI can tell judges exactly what is missing. */
  liveModeMissing: string[];
}

export function ethToInr(premiumEth: number, inrPerEth: number): number {
  if (!Number.isFinite(premiumEth) || premiumEth <= 0) return 0;
  return Math.max(1, Math.round(premiumEth * inrPerEth));
}

/** Razorpay settles in paise; every gateway call uses this integer. */
export function inrToPaise(amountInr: number): number {
  return Math.round(amountInr * 100);
}

export function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}
