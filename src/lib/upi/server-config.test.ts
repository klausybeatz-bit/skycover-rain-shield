import { afterEach, describe, expect, it } from "vitest";

import { getPublicUpiConfig, getUpiServerConfig, liveModeMissing } from "./server-config";

/**
 * Configuration behaviour, and the two guarantees that matter here: the public
 * (browser-facing) view must never carry a secret value, and a missing key pair
 * must switch the app into a clearly labelled simulated mode instead of
 * pretending a live payment could succeed.
 *
 * The values below are made-up placeholders. No real credential is used.
 */

const ENV_KEYS = [
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "UPI_DEMO_MODE",
  "UPI_INR_PER_ETH",
] as const;

const TEST_SECRET = "test_secret_value_never_public";
const TEST_WEBHOOK_SECRET = "test_webhook_value_never_public";

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

function setEnv(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

/** The key pair alone — everything live checkout needs, and nothing more. */
function setLiveEnv(overrides: Record<string, string> = {}) {
  setEnv({
    RAZORPAY_KEY_ID: "rzp_test_keyid",
    RAZORPAY_KEY_SECRET: TEST_SECRET,
    ...overrides,
  });
}

afterEach(clearEnv);

describe("UPI server configuration", () => {
  it("falls back to a simulated mode and lists the missing variable names when nothing is configured", () => {
    clearEnv();
    const config = getUpiServerConfig();

    expect(config.mode).toBe("simulated");
    expect(config.provider).toBe("none");
    expect(config.missing).toEqual(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    // Even on the server object, the secrets are null rather than empty strings,
    // so a caller cannot accidentally serialise a "configured" value.
    expect(config.keySecret).toBeNull();
    expect(config.webhookSecret).toBeNull();
  });

  it("enables live checkout from the key pair alone", () => {
    clearEnv();
    setLiveEnv();

    const config = getUpiServerConfig();
    expect(config.mode).toBe("live");
    expect(config.provider).toBe("razorpay");
    expect(config.missing).toEqual([]);
  });

  it("keeps checkout disabled when the key secret is missing", () => {
    clearEnv();
    setEnv({ RAZORPAY_KEY_ID: "rzp_test_keyid" });

    const config = getUpiServerConfig();
    expect(config.mode).toBe("simulated");
    expect(liveModeMissing(config)).toEqual(["RAZORPAY_KEY_SECRET"]);
  });

  it("reports an unset webhook secret without taking checkout down", () => {
    clearEnv();
    setLiveEnv();

    const config = getUpiServerConfig();
    expect(config.webhookSecret).toBeNull();
    // The webhook is a reconciliation channel, not the authenticity gate: a
    // signed checkout callback plus a Payments API read already proves the
    // payment on their own.
    expect(config.mode).toBe("live");
    expect(liveModeMissing(config)).toEqual([]);
  });

  it("picks up the webhook secret when it is configured", () => {
    clearEnv();
    setLiveEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET });

    expect(getUpiServerConfig().webhookSecret).toBe(TEST_WEBHOOK_SECRET);
  });

  it("honours a deliberate demo override even with credentials present", () => {
    clearEnv();
    setLiveEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET, UPI_DEMO_MODE: "true" });

    const config = getUpiServerConfig();
    expect(config.mode).toBe("simulated");
    expect(liveModeMissing(config)).toEqual(["UPI_DEMO_MODE=true"]);
  });

  it("uses the configured INR rate and ignores a nonsense one", () => {
    clearEnv();
    setEnv({ UPI_INR_PER_ETH: "90000" });
    expect(getUpiServerConfig().inrPerEth).toBe(90_000);

    setEnv({ UPI_INR_PER_ETH: "not-a-number" });
    expect(getUpiServerConfig().inrPerEth).toBe(250_000);
  });
});

describe("public UPI configuration", () => {
  it("exposes no secret value when live credentials are configured", () => {
    clearEnv();
    setLiveEnv({ RAZORPAY_WEBHOOK_SECRET: TEST_WEBHOOK_SECRET });

    const view = getPublicUpiConfig();
    const serialised = JSON.stringify(view);

    expect(view.mode).toBe("live");
    expect(view.publicKeyId).toBe("rzp_test_keyid");
    expect(serialised).not.toContain(TEST_SECRET);
    expect(serialised).not.toContain(TEST_WEBHOOK_SECRET);
    expect(Object.keys(view)).not.toContain("keySecret");
    expect(Object.keys(view)).not.toContain("webhookSecret");
  });

  it("reports the missing variable names, never their values, in demo mode", () => {
    clearEnv();
    const view = getPublicUpiConfig();

    expect(view.mode).toBe("simulated");
    expect(view.publicKeyId).toBeNull();
    expect(view.liveModeMissing).toEqual(["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"]);
    expect(JSON.stringify(view.liveModeMissing)).not.toContain("=");
  });

  it("labels a test key pair as test mode", () => {
    clearEnv();
    setLiveEnv();

    expect(getPublicUpiConfig().testMode).toBe(true);
  });

  it("does not label a live key pair as test mode", () => {
    clearEnv();
    setLiveEnv({ RAZORPAY_KEY_ID: "rzp_live_keyid" });

    expect(getPublicUpiConfig().testMode).toBe(false);
  });
});
