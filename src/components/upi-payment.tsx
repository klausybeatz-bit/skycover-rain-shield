import { Link } from "@tanstack/react-router";
import { BadgeCheck, IndianRupee, Info, Loader2, Smartphone, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SimulatedBadge } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createUpiPremiumOrder,
  getUpiConfig,
  getUpiPremiumOrder,
  simulateUpiPremiumPayment,
  verifyUpiPremiumPayment,
} from "@/lib/upi/server-fns";
import {
  ethToInr,
  formatInr,
  inrToPaise,
  type PolicyDraft,
  type UpiConfigView,
  type UpiOrderView,
} from "@/lib/upi/types";

/**
 * The Razorpay Checkout script is loaded from the gateway's own CDN only when a
 * real payment is about to start, so a demo visitor never downloads it and the
 * card details / UPI authentication happen inside the gateway's own screen.
 * SkyCover never sees, asks for, or stores a UPI PIN.
 */
const CHECKOUT_SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";

interface CheckoutResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

interface CheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: CheckoutResponse) => void;
  notes?: Record<string, string>;
  theme?: { color?: string };
  config?: unknown;
  modal?: { ondismiss?: () => void };
}

declare global {
  interface Window {
    Razorpay?: new (options: CheckoutOptions) => { open: () => void };
  }
}

let checkoutPromise: Promise<void> | null = null;

function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("UPI checkout can only open in a browser."));
  }
  if (window.Razorpay) return Promise.resolve();
  if (!checkoutPromise) {
    checkoutPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHECKOUT_SCRIPT;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        checkoutPromise = null;
        reject(new Error("Could not load the UPI checkout from the payment gateway. Check your connection and try again."));
      };
      document.head.appendChild(script);
    });
  }
  return checkoutPromise;
}

type Phase = "idle" | "opening" | "awaiting" | "verifying" | "paid" | "failed";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not started",
  opening: "Opening checkout…",
  awaiting: "Waiting for payment",
  verifying: "Verifying with the gateway…",
  paid: "Payment verified",
  failed: "Not completed",
};

export function UpiPaymentPanel({
  draft,
  onVerified,
}: {
  /** The policy being bought, or null while the form is incomplete. */
  draft: PolicyDraft | null;
  /** Called once, after the server has confirmed the payment. */
  onVerified: (order: UpiOrderView) => void;
}) {
  const [config, setConfig] = useState<UpiConfigView | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [order, setOrder] = useState<UpiOrderView | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const activated = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getUpiConfig()
      .then((next) => {
        if (!cancelled) setConfig(next);
      })
      .catch(() => {
        if (!cancelled) setConfigError("Could not read the payment configuration from the server.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function fail(reason: string, nextOrder?: UpiOrderView | null) {
    setPhase("failed");
    setMessage(reason);
    if (nextOrder) setOrder(nextOrder);
  }

  /** The only path that can mark the policy as paid. */
  function settle(verified: UpiOrderView) {
    setOrder(verified);
    setPhase("paid");
    setMessage(null);
    if (!activated.current) {
      activated.current = true;
      onVerified(verified);
    }
  }

  async function startPayment() {
    if (!draft) return;
    setPhase("opening");
    setMessage(null);
    try {
      const result = await createUpiPremiumOrder({ data: { policyDraft: draft } });
      if (!result.ok) {
        fail(result.reason, result.order);
        return;
      }
      setOrder(result.order);
      if (result.order.mode === "simulated") {
        setPhase("awaiting");
        return;
      }
      await openCheckout(result.order);
    } catch (error) {
      fail(error instanceof Error ? error.message : "The payment could not be started.");
    }
  }

  async function openCheckout(current: UpiOrderView) {
    const key = config?.publicKeyId;
    if (!key || !current.gatewayOrderId) {
      fail("The payment gateway is not fully configured on this server.");
      return;
    }
    try {
      await loadCheckoutScript();
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not open the UPI checkout.");
      return;
    }
    if (!window.Razorpay) {
      fail("The payment gateway checkout did not initialise.");
      return;
    }

    const checkout = new window.Razorpay({
      key,
      amount: inrToPaise(current.amountInr),
      currency: "INR",
      name: "SkyCover",
      description: `Rain cover for ${current.policyDraft.locationName}`,
      order_id: current.gatewayOrderId,
      theme: { color: "#183D35" },
      // Ask Checkout to show UPI first. Which UPI apps are offered is decided by
      // the gateway from the customer's own device, so no app list is hard-coded.
      config: {
        display: {
          blocks: { upi: { name: "Pay with any UPI app", instruments: [{ method: "upi" }] } },
          sequence: ["block.upi"],
          preferences: { show_default_blocks: true },
        },
      },
      notes: { skycoverOrderId: current.orderId },
      modal: {
        ondismiss: () =>
          fail("Checkout was closed before the payment completed. The order is still pending on the server."),
      },
      handler: (response) => {
        void verify(current, response);
      },
    });
    checkout.open();
    setPhase("awaiting");
  }

  async function verify(current: UpiOrderView, response: CheckoutResponse) {
    setPhase("verifying");
    setMessage(null);
    try {
      const result = await verifyUpiPremiumPayment({
        data: {
          orderId: current.orderId,
          gatewayOrderId: response.razorpay_order_id,
          paymentId: response.razorpay_payment_id,
          signature: response.razorpay_signature,
        },
      });
      if (!result.ok) {
        fail(result.reason, result.order);
        return;
      }
      settle(result.order);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "The payment could not be verified. If money left your account, quote the order id to support.",
      );
    }
  }

  /**
   * Re-read the server-side status. UPI apps often return the customer to the
   * browser without a reliable redirect, so this exists to recover an order a
   * webhook has already settled — the browser still never decides the outcome.
   */
  async function checkStatus() {
    if (!order) return;
    setPhase("verifying");
    setMessage(null);
    try {
      const latest = await getUpiPremiumOrder({ data: { orderId: order.orderId } });
      if (!latest) {
        fail("This order is no longer held on the server. If money left your account, contact support with the order id.");
        return;
      }
      if (latest.status === "paid") {
        settle(latest);
        return;
      }
      setOrder(latest);
      setPhase(latest.status === "failed" ? "failed" : "awaiting");
      setMessage(
        latest.failureReason ??
          `The server still reports this order as ${latest.status}. Nothing has been charged for a pending order.`,
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : "Could not read the order status.");
    }
  }

  async function simulate() {
    if (!order) return;
    setPhase("verifying");
    setMessage(null);
    try {
      const result = await simulateUpiPremiumPayment({ data: { orderId: order.orderId } });
      if (!result.ok) {
        fail(result.reason, result.order);
        return;
      }
      settle(result.order);
    } catch (error) {
      fail(error instanceof Error ? error.message : "The simulated payment could not be recorded.");
    }
  }

  const busy = phase === "opening" || phase === "verifying";
  const amountInr = order?.amountInr ?? (draft && config ? ethToInr(draft.premiumEth, config.inrPerEth) : null);
  const amountEth = order?.amountEth ?? draft?.premiumEth ?? null;
  const simulated = order ? order.simulated || order.mode === "simulated" : config?.mode === "simulated";

  return (
    <Card className="border-forest/25 bg-card">
      <CardHeader className="border-b border-border pb-5">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <Smartphone className="size-5 text-forest" /> Pay Premium with UPI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        {configError ? (
          <Notice tone="warn">{configError}</Notice>
        ) : !config ? (
          <p className="text-sm text-muted-foreground">Reading payment configuration…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Premium payable
                </div>
                <div className="mt-1 font-display text-3xl font-semibold text-forest">
                  {amountInr === null ? "—" : formatInr(amountInr)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {amountEth === null ? "Configure the policy to see a price." : `${amountEth} ETH of coverage value`}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge variant="outline" className={phase === "paid" ? "border-sage/70 bg-sage/20 text-sage-strong" : "border-border bg-muted text-muted-foreground"}>
                  {busy ? <Loader2 className="animate-spin" /> : phase === "paid" ? <BadgeCheck /> : <IndianRupee />}
                  {PHASE_LABEL[phase]}
                </Badge>
                {simulated && <SimulatedBadge>Simulated UPI</SimulatedBadge>}
              </div>
            </div>

            {config.mode === "simulated" && (
              <Notice tone="warn">
                <span className="font-semibold">Demo mode — no real money moves.</span> This server has no live
                payment credentials
                {config.liveModeMissing.length > 0 ? (
                  <> (missing: {config.liveModeMissing.join(", ")})</>
                ) : null}
                , so the button below runs a simulated UPI settlement for evaluation only. It never contacts a bank or
                a UPI app.
              </Notice>
            )}

            {message && <Notice tone={phase === "paid" ? "success" : "warn"}>{message}</Notice>}

            {phase === "paid" && order ? (
              <div className="space-y-3 rounded-xl border border-sage/50 bg-sage/10 p-4 text-[0.875rem]">
                <div className="flex items-center gap-2 font-semibold text-sage-strong">
                  <BadgeCheck className="size-4" />
                  {order.simulated
                    ? "Simulated payment recorded — no real money moved"
                    : "Payment verified by the gateway — policy activated"}
                </div>
                <dl className="grid gap-1.5 text-xs text-muted-foreground">
                  <Detail label="Order" value={order.orderId} />
                  <Detail label="Amount" value={formatInr(order.amountInr)} />
                  <Detail label="Paid at" value={order.paidAt ? new Date(order.paidAt).toLocaleString() : "—"} />
                  <Detail
                    label="Verification"
                    value={
                      order.simulated
                        ? "Simulated (demo mode)"
                        : `Server-verified — ${order.verification ?? "unknown"}`
                    }
                  />
                  {order.paymentRef && !order.simulated && (
                    <Detail label="Gateway payment id" value={order.paymentRef} />
                  )}
                </dl>
                <Button asChild className="h-11 w-full font-semibold">
                  <Link to="/policies">View my policies</Link>
                </Button>
              </div>
            ) : (
              <>
                <Button className="h-12 w-full text-sm font-semibold" disabled={!draft || busy} onClick={startPayment}>
                  {busy ? "Please wait…" : phase === "failed" || phase === "awaiting" ? "Retry UPI payment" : "Pay Premium with UPI"}
                </Button>

                {order && config.mode === "simulated" && order.status !== "paid" && (
                  <Button
                    variant="secondary"
                    className="h-12 w-full text-sm font-semibold"
                    disabled={busy}
                    onClick={simulate}
                  >
                    {busy ? "Please wait…" : "Simulate a successful UPI payment"}
                  </Button>
                )}

                {order && config.mode === "live" && order.status !== "paid" && (
                  <Button variant="secondary" className="h-12 w-full text-sm font-semibold" disabled={busy} onClick={checkStatus}>
                    I have paid — check the order status
                  </Button>
                )}
              </>
            )}

            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {config.mode === "live"
                ? "UPI authentication happens inside your bank's or UPI app's own screen. SkyCover never asks for, sees, or stores your UPI PIN."
                : "The live gateway would open a UPI checkout hosted by the payment provider; SkyCover never asks for, sees, or stores a UPI PIN."}{" "}
              A policy is activated only after the server verifies the payment with the gateway — never from this browser
              screen alone.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Notice({ tone, children }: { tone: "warn" | "success"; children: React.ReactNode }) {
  const toneClass =
    tone === "success"
      ? "border-sage/50 bg-sage/10 text-sage-strong"
      : "border-amber/50 bg-amber/10 text-amber-strong";
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-xs leading-relaxed ${toneClass}`}>
      {tone === "success" ? (
        <BadgeCheck className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div>{children}</div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt>{label}</dt>
      <dd className="truncate font-mono text-[0.6875rem] text-foreground">{value}</dd>
    </div>
  );
}
