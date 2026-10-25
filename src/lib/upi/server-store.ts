/**
 * Server-only order book for UPI premium payments.
 *
 * This is the single place that decides whether a payment really happened. The
 * browser can ask for a status but can never set one.
 *
 * IDEMPOTENCY
 * -----------
 * `markPaid` is deliberately idempotent in the safe direction and strict in the
 * unsafe one:
 *   - the same gateway payment id applied twice to the same order is a no-op
 *     (gateways retry webhooks), so the call succeeds without double-counting;
 *   - the same gateway payment id applied to a *different* order is rejected,
 *     which is what stops one real payment from activating two policies;
 *   - a different payment id applied to an already-paid order is rejected.
 *
 * STORAGE
 * -------
 * Orders live in a module-level Map. That is honest for a prototype and for a
 * single server process, but it is NOT durable: a restart clears pending
 * orders, and multi-instance or serverless deployments (the Nitro build targets
 * a Cloudflare Worker) do not share the Map between isolates. Production must
 * swap this for a durable store — see README "UPI payments".
 */

import type { PolicyDraft, UpiOrderStatus, UpiVerification } from "./types";

/** Web Crypto is available in Node 19+ and in the Cloudflare Workers runtime. */
function newId(): string {
  return globalThis.crypto.randomUUID();
}

export interface UpiOrder {
  id: string;
  policyDraft: PolicyDraft;
  amountInr: number;
  amountPaise: number;
  currency: "INR";
  provider: "razorpay" | "simulated";
  gatewayOrderId: string | null;
  status: UpiOrderStatus;
  paymentRef: string | null;
  verification: UpiVerification | null;
  simulated: boolean;
  createdAt: number;
  paidAt: number | null;
  failureReason: string | null;
}

const orders = new Map<string, UpiOrder>();
/** paymentRef -> orderId, so one real payment can never activate two policies. */
const paymentIndex = new Map<string, string>();

/** TTL for abandoned pending orders, so the Map cannot grow without bound. */
const PENDING_TTL_MS = 60 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - PENDING_TTL_MS;
  for (const [id, order] of orders) {
    if (order.status === "pending" && order.createdAt < cutoff) {
      orders.delete(id);
    }
  }
}

export function createUpiOrder(input: {
  policyDraft: PolicyDraft;
  amountInr: number;
  amountPaise: number;
  provider: "razorpay" | "simulated";
}): UpiOrder {
  sweep();
  const order: UpiOrder = {
    id: `upi_${newId()}`,
    policyDraft: input.policyDraft,
    amountInr: input.amountInr,
    amountPaise: input.amountPaise,
    currency: "INR",
    provider: input.provider,
    gatewayOrderId: null,
    status: "pending",
    paymentRef: null,
    verification: null,
    simulated: input.provider === "simulated",
    createdAt: Date.now(),
    paidAt: null,
    failureReason: null,
  };
  orders.set(order.id, order);
  return order;
}

export function attachGatewayOrder(orderId: string, gatewayOrderId: string): UpiOrder | null {
  const order = orders.get(orderId);
  if (!order) return null;
  order.gatewayOrderId = gatewayOrderId;
  return order;
}

export function getUpiOrder(orderId: string): UpiOrder | null {
  return orders.get(orderId) ?? null;
}

export function findOrderByGatewayOrderId(gatewayOrderId: string): UpiOrder | null {
  for (const order of orders.values()) {
    if (order.gatewayOrderId === gatewayOrderId) return order;
  }
  return null;
}

export function findOrderByPaymentRef(paymentRef: string): UpiOrder | null {
  const orderId = paymentIndex.get(paymentRef);
  return orderId ? (orders.get(orderId) ?? null) : null;
}

export type MarkPaidResult =
  | { ok: true; order: UpiOrder; duplicate: boolean }
  | { ok: false; reason: string; order: UpiOrder | null };

/**
 * Record a verified payment. Callers must have already proven the payment
 * cryptographically (signature and/or a gateway API read) before calling this.
 */
export function markOrderPaid(input: {
  orderId: string;
  paymentRef: string;
  verification: UpiVerification;
  simulated: boolean;
  /** Amount the gateway actually captured, in paise, when known. */
  amountPaise?: number | undefined;
}): MarkPaidResult {
  const order = orders.get(input.orderId);
  if (!order) return { ok: false, reason: "Unknown order", order: null };

  if (
    input.amountPaise !== undefined &&
    input.amountPaise !== order.amountPaise &&
    // Simulated payments carry no captured amount.
    !input.simulated
  ) {
    return {
      ok: false,
      reason: `Paid amount (${input.amountPaise} paise) does not match the order amount (${order.amountPaise} paise)`,
      order,
    };
  }

  const boundOrderId = paymentIndex.get(input.paymentRef);
  if (boundOrderId && boundOrderId !== order.id) {
    return {
      ok: false,
      reason: "This payment reference has already been used for another order",
      order,
    };
  }

  if (order.status === "paid") {
    // Same payment replayed by a webhook retry — nothing to do.
    if (order.paymentRef === input.paymentRef) {
      return { ok: true, order, duplicate: true };
    }
    return {
      ok: false,
      reason: "Order is already paid with a different payment reference",
      order,
    };
  }

  order.status = "paid";
  order.paymentRef = input.paymentRef;
  order.verification = input.verification;
  order.simulated = input.simulated;
  order.paidAt = Date.now();
  order.failureReason = null;
  paymentIndex.set(input.paymentRef, order.id);

  return { ok: true, order, duplicate: false };
}

export function markOrderFailed(orderId: string, reason: string): UpiOrder | null {
  const order = orders.get(orderId);
  if (!order || order.status === "paid") return order ?? null;
  order.status = "failed";
  order.failureReason = reason;
  return order;
}

/** Test seam: drop all in-memory orders. */
export function resetUpiOrders() {
  orders.clear();
  paymentIndex.clear();
}
