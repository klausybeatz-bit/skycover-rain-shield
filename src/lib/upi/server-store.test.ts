import { beforeEach, describe, expect, it } from "vitest";

import type { PolicyDraft } from "./types";
import {
  createUpiOrder,
  getUpiOrder,
  markOrderFailed,
  markOrderPaid,
  resetUpiOrders,
  type UpiOrder,
} from "./server-store";

const draft: PolicyDraft = {
  locationName: "Nashik, Maharashtra",
  latitude: 20,
  longitude: 73.78,
  startDate: "2026-06-01",
  endDate: "2026-08-31",
  thresholdMm: 50,
  coverageEth: 0.1,
  premiumEth: 0.006,
};

function openOrder(provider: "razorpay" | "simulated" = "razorpay"): UpiOrder {
  return createUpiOrder({ policyDraft: draft, amountInr: 1500, amountPaise: 150_000, provider });
}

describe("UPI order idempotency", () => {
  beforeEach(() => resetUpiOrders());

  it("records a verified payment once", () => {
    const order = openOrder();
    const result = markOrderPaid({
      orderId: order.id,
      paymentRef: "pay_123",
      verification: "webhook",
      simulated: false,
      amountPaise: 150_000,
    });
    expect(result.ok).toBe(true);
    expect(getUpiOrder(order.id)?.status).toBe("paid");
  });

  it("treats a replayed webhook for the same order as a no-op", () => {
    const order = openOrder();
    const input = {
      orderId: order.id,
      paymentRef: "pay_123",
      verification: "webhook" as const,
      simulated: false,
      amountPaise: 150_000,
    };
    markOrderPaid(input);
    const replay = markOrderPaid(input);
    expect(replay).toEqual({ ok: true, order: expect.anything(), duplicate: true });
  });

  it("refuses to let one payment activate a second policy", () => {
    const first = openOrder();
    const second = openOrder();
    markOrderPaid({
      orderId: first.id,
      paymentRef: "pay_123",
      verification: "webhook",
      simulated: false,
      amountPaise: 150_000,
    });
    const stolen = markOrderPaid({
      orderId: second.id,
      paymentRef: "pay_123",
      verification: "webhook",
      simulated: false,
      amountPaise: 150_000,
    });
    expect(stolen.ok).toBe(false);
    expect(getUpiOrder(second.id)?.status).toBe("pending");
  });

  it("refuses a second, different payment on an already-paid order", () => {
    const order = openOrder();
    markOrderPaid({
      orderId: order.id,
      paymentRef: "pay_123",
      verification: "webhook",
      simulated: false,
      amountPaise: 150_000,
    });
    const extra = markOrderPaid({
      orderId: order.id,
      paymentRef: "pay_456",
      verification: "webhook",
      simulated: false,
      amountPaise: 150_000,
    });
    expect(extra.ok).toBe(false);
    expect(getUpiOrder(order.id)?.paymentRef).toBe("pay_123");
  });

  it("refuses a captured amount that does not match the order", () => {
    const order = openOrder();
    const result = markOrderPaid({
      orderId: order.id,
      paymentRef: "pay_123",
      verification: "gateway_api",
      simulated: false,
      amountPaise: 100,
    });
    expect(result.ok).toBe(false);
    expect(getUpiOrder(order.id)?.status).toBe("pending");
  });

  it("keeps simulated settlements free of any captured amount", () => {
    const order = openOrder("simulated");
    const result = markOrderPaid({
      orderId: order.id,
      paymentRef: `simulated:${order.id}`,
      verification: "simulated",
      simulated: true,
    });
    expect(result.ok).toBe(true);
    expect(getUpiOrder(order.id)?.simulated).toBe(true);
  });

  it("does not mark an unknown order paid", () => {
    const result = markOrderPaid({
      orderId: "upi_missing",
      paymentRef: "pay_123",
      verification: "webhook",
      simulated: false,
    });
    expect(result).toEqual({ ok: false, reason: "Unknown order", order: null });
  });

  it("never overwrites a paid order with a failure", () => {
    const order = openOrder();
    markOrderPaid({
      orderId: order.id,
      paymentRef: "pay_123",
      verification: "webhook",
      simulated: false,
      amountPaise: 150_000,
    });
    markOrderFailed(order.id, "gateway reported failure");
    expect(getUpiOrder(order.id)?.status).toBe("paid");
  });
});
