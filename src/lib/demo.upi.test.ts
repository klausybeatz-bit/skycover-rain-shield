import { afterEach, describe, expect, it } from "vitest";

import { clearDemoData, createDemoPolicy, getDemoState } from "./demo";
import type { UpiPaymentRecord } from "./demo";

/**
 * A policy only ever becomes `active` through `activateFromUpi`, which the buy
 * page calls after the server has verified the payment. These tests pin the
 * shape of that record: a verified payment and a clearly labelled simulated one
 * must not be confusable in the demo ledger.
 */

const base = {
  locationName: "Nashik, Maharashtra",
  latitude: 20,
  longitude: 73.78,
  startDate: "2026-06-01",
  endDate: "2026-08-31",
  thresholdMm: 50,
  coverageEth: 0.1,
  premiumEth: 0.006,
  holderAddress: null,
};

const verifiedPayment: UpiPaymentRecord = {
  orderId: "upi_verified",
  paymentRef: "pay_test_0001",
  amountInr: 1500,
  amountEth: 0.006,
  verification: "webhook",
  simulated: false,
  paidAt: 1_780_000_000_000,
};

const simulatedPayment: UpiPaymentRecord = {
  orderId: "upi_simulated",
  paymentRef: "simulated:upi_simulated",
  amountInr: 1500,
  amountEth: 0.006,
  verification: "simulated",
  simulated: true,
  paidAt: 1_780_000_000_000,
};

afterEach(() => clearDemoData());

describe("policy activation from a UPI payment", () => {
  it("activates a policy from a verified payment and keeps the gateway reference", () => {
    const policy = createDemoPolicy({ ...base, upiPayment: verifiedPayment });

    expect(policy.status).toBe("active");
    expect(policy.upiPayment).toEqual(verifiedPayment);
    expect(getDemoState().policies[0]?.id).toBe(policy.id);
  });

  it("never records a verified payment as simulated", () => {
    const policy = createDemoPolicy({ ...base, upiPayment: verifiedPayment });
    const event = getDemoState().events[0];

    expect(policy.upiPayment?.simulated).toBe(false);
    expect(event?.simulated).toBe(false);
    expect(event?.message).toContain("premium paid via UPI");
    expect(event?.message).not.toContain("simulated");
  });

  it("labels a simulated payment as simulated in both the record and the event", () => {
    const policy = createDemoPolicy({ ...base, upiPayment: simulatedPayment });
    const event = getDemoState().events[0];

    expect(policy.upiPayment?.verification).toBe("simulated");
    expect(policy.upiPayment?.simulated).toBe(true);
    expect(event?.simulated).toBe(true);
    expect(event?.message).toContain("simulated");
  });

  it("counts the premium towards the pool regardless of how it was paid", () => {
    const before = getDemoState().pool.balanceEth;
    createDemoPolicy({ ...base, upiPayment: verifiedPayment });
    expect(getDemoState().pool.balanceEth).toBeCloseTo(before + base.premiumEth, 10);
  });
});
