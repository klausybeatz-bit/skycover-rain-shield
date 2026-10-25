/**
 * Server-only Razorpay (UPI) gateway client.
 *
 * Authorization model, matching the provider's documented flow:
 *   - outbound calls are authenticated with HTTP Basic (key_id:key_secret);
 *   - an inbound webhook is trusted only if `X-Razorpay-Signature` matches an
 *     HMAC-SHA256 of the *raw* request body keyed with the webhook secret;
 *   - a checkout callback is trusted only if its `razorpay_signature` matches an
 *     HMAC-SHA256 of `${order_id}|${payment_id}` keyed with the key secret.
 *
 * A valid signature proves who sent the message. It does not by itself prove the
 * money settled, so `verifyUpiPayment` always follows up with
 * `fetchGatewayPayment` to read the authoritative status and captured amount
 * from the gateway's own API.
 *
 * HMAC is computed with Web Crypto, so there is no extra dependency.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";
const REQUEST_TIMEOUT_MS = 10_000;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

/** Length-independent XOR comparison, so a near-miss signature costs the same. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  webhookSecret: string,
): Promise<boolean> {
  if (!signatureHeader) return false;
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return constantTimeEqualHex(expected, signatureHeader.trim().toLowerCase());
}

export async function verifyCheckoutSignature(input: {
  gatewayOrderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): Promise<boolean> {
  const expected = await hmacSha256Hex(
    input.keySecret,
    `${input.gatewayOrderId}|${input.paymentId}`,
  );
  return constantTimeEqualHex(expected, input.signature.trim().toLowerCase());
}

function authHeader(keyId: string, keySecret: string): string {
  return `Basic ${btoa(`${keyId}:${keySecret}`)}`;
}

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createGatewayOrder(input: {
  keyId: string;
  keySecret: string;
  amountPaise: number;
  receipt: string;
  notes: Record<string, string>;
}): Promise<GatewayOrder> {
  const res = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: authHeader(input.keyId, input.keySecret),
    },
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: "INR",
      receipt: input.receipt,
      notes: input.notes,
      // Ask Checkout to surface the UPI block first. Which specific UPI apps
      // appear is decided by the gateway from the customer's device.
      method: "upi",
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    // Never echo the gateway error body verbatim: it can contain key metadata.
    throw new Error(`Payment gateway rejected the order (HTTP ${res.status})`);
  }
  return (await res.json()) as GatewayOrder;
}

export interface GatewayPayment {
  id: string;
  order_id: string | null;
  status: string;
  amount: number;
  currency: string;
  method: string | null;
  captured: boolean;
  error_description?: string | undefined;
}

export async function fetchGatewayPayment(input: {
  keyId: string;
  keySecret: string;
  paymentId: string;
}): Promise<GatewayPayment> {
  const res = await fetch(`${RAZORPAY_API}/payments/${encodeURIComponent(input.paymentId)}`, {
    headers: { authorization: authHeader(input.keyId, input.keySecret) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Could not read the payment from the gateway (HTTP ${res.status})`);
  }
  return (await res.json()) as GatewayPayment;
}
