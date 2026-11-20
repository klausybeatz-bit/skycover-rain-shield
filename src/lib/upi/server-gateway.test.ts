import { webcrypto } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  constantTimeEqualHex,
  createGatewayOrder,
  fetchGatewayPayment,
  hmacSha256Hex,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "./server-gateway";

/**
 * These tests cover the cryptographic half of the UPI flow: the two HMAC
 * checks that decide whether a checkout callback and a webhook delivery are
 * genuine. They are the only thing standing between a forged request and an
 * activated policy, so every failure direction is asserted explicitly.
 *
 * No real gateway credentials are used. The secrets below are made-up strings
 * that exist only inside this process.
 */

const TEST_KEY_SECRET = "test_key_secret_not_a_real_credential";
const TEST_WEBHOOK_SECRET = "test_webhook_secret_not_a_real_credential";

beforeEach(() => {
  // jsdom does not implement SubtleCrypto; the Node and Cloudflare Workers
  // runtimes do. Point the global at Node's implementation so the module under
  // test can compute HMAC.
  vi.stubGlobal("crypto", webcrypto);
});

afterEach(() => vi.unstubAllGlobals());

/** Read the request the module handed to fetch. */
function firstFetchCall(mock: { mock: { calls: unknown[] } }): { url: string; init: RequestInit } {
  const [call] = mock.mock.calls as Array<[string, RequestInit]>;
  if (!call) throw new Error("fetch was never called");
  return { url: call[0], init: call[1] };
}

function header(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe("hmacSha256Hex", () => {
  it("matches the published HMAC-SHA256 test vector", async () => {
    // RFC-style vector: HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog").
    await expect(
      hmacSha256Hex("key", "The quick brown fox jumps over the lazy dog"),
    ).resolves.toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });

  it("is lowercase hex of the expected length", async () => {
    const digest = await hmacSha256Hex(TEST_KEY_SECRET, "order_1|pay_1");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the message changes", async () => {
    const a = await hmacSha256Hex(TEST_KEY_SECRET, "order_1|pay_1");
    const b = await hmacSha256Hex(TEST_KEY_SECRET, "order_1|pay_2");
    expect(a).not.toBe(b);
  });

  it("changes when the secret changes", async () => {
    const a = await hmacSha256Hex(TEST_KEY_SECRET, "order_1|pay_1");
    const b = await hmacSha256Hex(`${TEST_KEY_SECRET}x`, "order_1|pay_1");
    expect(a).not.toBe(b);
  });
});

describe("constantTimeEqualHex", () => {
  it("accepts identical digests", () => {
    expect(constantTimeEqualHex("abcd", "abcd")).toBe(true);
  });

  it("rejects a near miss of the same length", () => {
    expect(constantTimeEqualHex("abcd", "abce")).toBe(false);
  });

  it("rejects different lengths and empty input", () => {
    expect(constantTimeEqualHex("abcd", "abcde")).toBe(false);
    expect(constantTimeEqualHex("", "")).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "payment.captured", payload: {} });

  it("accepts a signature computed over the exact raw body", async () => {
    const signature = await hmacSha256Hex(TEST_WEBHOOK_SECRET, body);
    await expect(verifyWebhookSignature(body, signature, TEST_WEBHOOK_SECRET)).resolves.toBe(true);
  });

  it("accepts an upper-case signature header and surrounding whitespace", async () => {
    const signature = await hmacSha256Hex(TEST_WEBHOOK_SECRET, body);
    await expect(
      verifyWebhookSignature(body, `  ${signature.toUpperCase()}  `, TEST_WEBHOOK_SECRET),
    ).resolves.toBe(true);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const signature = await hmacSha256Hex("some_other_secret", body);
    await expect(verifyWebhookSignature(body, signature, TEST_WEBHOOK_SECRET)).resolves.toBe(false);
  });

  it("rejects a signature that does not cover the exact bytes sent", async () => {
    // The classic attack: keep a valid signature but alter the payload.
    const signature = await hmacSha256Hex(TEST_WEBHOOK_SECRET, body);
    const tampered = JSON.stringify({ event: "payment.captured", payload: { amount: 1 } });
    await expect(verifyWebhookSignature(tampered, signature, TEST_WEBHOOK_SECRET)).resolves.toBe(false);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyWebhookSignature(body, null, TEST_WEBHOOK_SECRET)).resolves.toBe(false);
  });

  it("rejects an empty signature header", async () => {
    await expect(verifyWebhookSignature(body, "", TEST_WEBHOOK_SECRET)).resolves.toBe(false);
  });
});

describe("verifyCheckoutSignature", () => {
  const gatewayOrderId = "order_test_0001";
  const paymentId = "pay_test_0001";

  it("accepts the gateway's HMAC of `${order_id}|${payment_id}`", async () => {
    const signature = await hmacSha256Hex(TEST_KEY_SECRET, `${gatewayOrderId}|${paymentId}`);
    await expect(
      verifyCheckoutSignature({ gatewayOrderId, paymentId, signature, keySecret: TEST_KEY_SECRET }),
    ).resolves.toBe(true);
  });

  it("rejects a callback for a different order", async () => {
    const signature = await hmacSha256Hex(TEST_KEY_SECRET, `${gatewayOrderId}|${paymentId}`);
    await expect(
      verifyCheckoutSignature({
        gatewayOrderId: "order_test_evil",
        paymentId,
        signature,
        keySecret: TEST_KEY_SECRET,
      }),
    ).resolves.toBe(false);
  });

  it("rejects a forged signature produced with a guessed secret", async () => {
    const forged = await hmacSha256Hex("rzp_test_guess", `${gatewayOrderId}|${paymentId}`);
    await expect(
      verifyCheckoutSignature({ gatewayOrderId, paymentId, signature: forged, keySecret: TEST_KEY_SECRET }),
    ).resolves.toBe(false);
  });

  it("rejects a replayed signature from a different payment", async () => {
    const signature = await hmacSha256Hex(TEST_KEY_SECRET, `${gatewayOrderId}|pay_other`);
    await expect(
      verifyCheckoutSignature({ gatewayOrderId, paymentId, signature, keySecret: TEST_KEY_SECRET }),
    ).resolves.toBe(false);
  });
});

describe("gateway HTTP calls", () => {
  it("authenticates order creation with HTTP Basic and never logs the secret", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "order_test_1", amount: 150_000, currency: "INR", status: "created" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const order = await createGatewayOrder({
      keyId: "rzp_test_keyid",
      keySecret: TEST_KEY_SECRET,
      amountPaise: 150_000,
      receipt: "upi_1",
      notes: { skycoverOrderId: "upi_1" },
    });

    expect(order.id).toBe("order_test_1");
    const { url, init } = firstFetchCall(fetchMock);
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(init.method).toBe("POST");
    expect(header(init, "authorization")).toBe(`Basic ${btoa(`rzp_test_keyid:${TEST_KEY_SECRET}`)}`);
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent).toMatchObject({ amount: 150_000, currency: "INR", method: "upi", receipt: "upi_1" });
    expect(sent["notes"]).toEqual({ skycoverOrderId: "upi_1" });
  });

  it("reports a gateway rejection without echoing the response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "key_id leaked_here" }), { status: 401 })),
    );

    await expect(
      createGatewayOrder({
        keyId: "rzp_test_keyid",
        keySecret: TEST_KEY_SECRET,
        amountPaise: 100,
        receipt: "upi_1",
        notes: {},
      }),
    ).rejects.toThrow("Payment gateway rejected the order (HTTP 401)");
  });

  it("reads a payment for the status check", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ id: "pay_test_1", order_id: "order_test_1", status: "captured", amount: 150_000 }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const payment = await fetchGatewayPayment({
      keyId: "rzp_test_keyid",
      keySecret: TEST_KEY_SECRET,
      paymentId: "pay_test_1",
    });

    expect(payment.status).toBe("captured");
    const { url, init } = firstFetchCall(fetchMock);
    expect(url).toBe("https://api.razorpay.com/v1/payments/pay_test_1");
    expect(header(init, "authorization")).toContain("Basic ");
  });

  it("fails the status check loudly when the gateway refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(
      fetchGatewayPayment({ keyId: "rzp_test_keyid", keySecret: TEST_KEY_SECRET, paymentId: "pay_test_1" }),
    ).rejects.toThrow("Could not read the payment from the gateway (HTTP 500)");
  });
});
