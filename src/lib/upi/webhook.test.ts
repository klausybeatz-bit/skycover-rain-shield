import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hmacSha256Hex } from "./server-gateway";
import {
  attachGatewayOrder,
  createUpiOrder,
  getUpiOrder,
  resetUpiOrders,
} from "./server-store";
import { handleUpiWebhook } from "./webhook";
import type { PolicyDraft } from "./types";

/**
 * End-to-end behaviour of the webhook endpoint. This is the path a real
 * settlement arrives on, so the tests assert both directions: a genuine,
 * correctly signed delivery settles the order exactly once, and anything else —
 * a bad signature, a tampered body, a mismatched amount, a missing
 * configuration — is refused without ever marking an order paid.
 */

const WEBHOOK_SECRET = "test_webhook_secret_not_a_real_credential";

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

function openGatewayOrder(): { orderId: string; gatewayOrderId: string } {
  const order = createUpiOrder({
    policyDraft: draft,
    amountInr: 1500,
    amountPaise: 150_000,
    provider: "razorpay",
  });
  const gatewayOrderId = `order_test_${order.id}`;
  attachGatewayOrder(order.id, gatewayOrderId);
  return { orderId: order.id, gatewayOrderId };
}

function capturedBody(gatewayOrderId: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_test_0001",
          order_id: gatewayOrderId,
          status: "captured",
          amount: 150_000,
          currency: "INR",
          ...overrides,
        },
      },
    },
  });
}

async function deliver(body: string, signature?: string | null): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== null) {
    headers["x-razorpay-signature"] = signature ?? (await hmacSha256Hex(WEBHOOK_SECRET, body));
  }
  return handleUpiWebhook(
    new Request("https://skycover.example/api/upi/webhook", { method: "POST", body, headers }),
  );
}

const ENV_KEYS = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "UPI_DEMO_MODE",
] as const;

const TEST_KEY_SECRET = "test_secret_not_a_real_credential";

function enableLiveMode() {
  process.env["RAZORPAY_KEY_ID"] = "rzp_test_keyid";
  process.env["RAZORPAY_KEY_SECRET"] = TEST_KEY_SECRET;
  process.env["RAZORPAY_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
}

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  resetUpiOrders();
  clearEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearEnv();
  resetUpiOrders();
});

describe("GET probe", () => {
  it("reports the mode without exposing any secret", async () => {
    const res = await handleUpiWebhook(new Request("https://skycover.example/api/upi/webhook"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ endpoint: "/api/upi/webhook", accepts: "POST", mode: "simulated" });
  });
});

describe("no signing secret", () => {
  it("refuses to process a webhook and names the missing variable", async () => {
    const { gatewayOrderId } = openGatewayOrder();
    const body = capturedBody(gatewayOrderId);

    // Signed with a real secret, but this server has no webhook secret, so it
    // cannot tell whether the signature is genuine — it must not guess.
    const res = await deliver(body, await hmacSha256Hex(WEBHOOK_SECRET, body));

    expect(res.status).toBe(503);
    const payload = (await res.json()) as { missing?: string[] };
    expect(payload.missing).toEqual(["RAZORPAY_WEBHOOK_SECRET"]);
  });

  it("stays closed even when checkout itself is live", async () => {
    // Live checkout does not imply a verifiable webhook; the two are separate.
    process.env["RAZORPAY_KEY_ID"] = "rzp_test_keyid";
    process.env["RAZORPAY_KEY_SECRET"] = TEST_KEY_SECRET;
    const { gatewayOrderId } = openGatewayOrder();

    const res = await deliver(capturedBody(gatewayOrderId));

    expect(res.status).toBe(503);
    expect(((await res.json()) as { missing?: string[] }).missing).toEqual(["RAZORPAY_WEBHOOK_SECRET"]);
  });

  it("does not activate a policy when it cannot verify", async () => {
    const { orderId, gatewayOrderId } = openGatewayOrder();
    await deliver(capturedBody(gatewayOrderId));
    expect(getUpiOrder(orderId)?.status).toBe("pending");
  });
});

describe("live mode switched off", () => {
  it("refuses a signed delivery and explains that demo mode is forced", async () => {
    process.env["UPI_DEMO_MODE"] = "true";
    process.env["RAZORPAY_WEBHOOK_SECRET"] = WEBHOOK_SECRET;
    const { gatewayOrderId } = openGatewayOrder();

    const res = await deliver(capturedBody(gatewayOrderId));

    expect(res.status).toBe(503);
    expect(((await res.json()) as { missing?: string[] }).missing).toEqual(["UPI_DEMO_MODE=true"]);
  });
});

describe("signature verification", () => {
  it("rejects a request with no signature header", async () => {
    enableLiveMode();
    const { gatewayOrderId } = openGatewayOrder();
    const res = await deliver(capturedBody(gatewayOrderId), null);
    expect(res.status).toBe(401);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    enableLiveMode();
    const { gatewayOrderId } = openGatewayOrder();
    const body = capturedBody(gatewayOrderId);
    const res = await deliver(body, await hmacSha256Hex("wrong_secret", body));
    expect(res.status).toBe(401);
  });

  it("rejects a valid signature attached to a tampered body", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();
    const original = capturedBody(gatewayOrderId);
    const signature = await hmacSha256Hex(WEBHOOK_SECRET, original);
    const tampered = capturedBody(gatewayOrderId, { amount: 1 });

    const res = await deliver(tampered, signature);
    expect(res.status).toBe(401);
    expect(getUpiOrder(orderId)?.status).toBe("pending");
  });
});

describe("successful settlement", () => {
  it("marks the order paid and records the gateway payment id", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();

    const res = await deliver(capturedBody(gatewayOrderId));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: true, duplicate: false });

    const order = getUpiOrder(orderId);
    expect(order?.status).toBe("paid");
    expect(order?.paymentRef).toBe("pay_test_0001");
    expect(order?.verification).toBe("webhook");
    expect(order?.simulated).toBe(false);
  });

  it("treats a duplicate delivery as a no-op and never double-counts", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();
    const body = capturedBody(gatewayOrderId);

    const first = await deliver(body);
    const paidAt = getUpiOrder(orderId)?.paidAt;
    const replay = await deliver(body);

    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ received: true, applied: true, duplicate: true });
    expect(getUpiOrder(orderId)?.status).toBe("paid");
    // The replay must not re-stamp the order.
    expect(getUpiOrder(orderId)?.paidAt).toBe(paidAt);
  });

  it("rejects a captured amount that does not match the order", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();

    const res = await deliver(capturedBody(gatewayOrderId, { id: "pay_test_small", amount: 100 }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: false });
    expect(getUpiOrder(orderId)?.status).toBe("pending");
  });

  it("acknowledges a signed event for an order it does not hold", async () => {
    enableLiveMode();
    const res = await deliver(capturedBody("order_test_unknown"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: false, reason: "Unknown order" });
  });

  it("acknowledges a signed non-settlement event without changing anything", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();
    const body = JSON.stringify({ event: "payment.authorized", payload: { payout: { entity: {} } } });
    const res = await deliver(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: false });
    expect(getUpiOrder(orderId)?.status).toBe("pending");
  });

  it("rejects a signed body that is not JSON", async () => {
    enableLiveMode();
    const body = "not-json";
    const res = await deliver(body, await hmacSha256Hex(WEBHOOK_SECRET, body));
    expect(res.status).toBe(400);
  });
});

describe("failed payment", () => {
  it("records the failure and never activates the policy", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();
    const body = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_test_fail", order_id: gatewayOrderId, status: "failed" } } },
    });

    const res = await deliver(body);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: true, applied: true, status: "failed" });

    const order = getUpiOrder(orderId);
    expect(order?.status).toBe("failed");
    expect(order?.paymentRef).toBeNull();
    expect(order?.failureReason).toBeTruthy();
  });

  it("never downgrades an already-paid order", async () => {
    enableLiveMode();
    const { orderId, gatewayOrderId } = openGatewayOrder();
    await deliver(capturedBody(gatewayOrderId));

    const failure = JSON.stringify({
      event: "payment.failed",
      payload: { payment: { entity: { id: "pay_test_0001", order_id: gatewayOrderId, status: "failed" } } },
    });
    await deliver(failure);

    expect(getUpiOrder(orderId)?.status).toBe("paid");
  });

  it("refuses to let one payment settle two orders", async () => {
    enableLiveMode();
    const first = openGatewayOrder();
    const second = openGatewayOrder();
    await deliver(capturedBody(first.gatewayOrderId));

    const stolen = await deliver(capturedBody(second.gatewayOrderId, { id: "pay_test_0001" }));

    // 409, not 200: a genuine conflict should be visible rather than retried away.
    expect(stolen.status).toBe(409);
    expect(getUpiOrder(second.orderId)?.status).toBe("pending");
  });
});

describe("leakage", () => {
  it("never echoes a secret in a webhook response", async () => {
    enableLiveMode();
    const { gatewayOrderId } = openGatewayOrder();
    const responses = await Promise.all([
      deliver(capturedBody(gatewayOrderId)),
      deliver(capturedBody(gatewayOrderId), "deadbeef"),
      deliver("not-json", await hmacSha256Hex(WEBHOOK_SECRET, "not-json")),
    ]);

    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(WEBHOOK_SECRET);
      expect(text).not.toContain(TEST_KEY_SECRET);
    }
  });
});
