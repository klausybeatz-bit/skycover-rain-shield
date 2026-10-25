/**
 * Server functions that back the UPI premium flow.
 *
 * Every function here runs on the server only. The browser can ask for an
 * order, ask for its status, and ask for a payment to be verified — it can
 * never declare a payment successful. The order status is owned by
 * server-store.ts, and it only changes after a cryptographic check against the
 * gateway (see the two functions below) or an explicit simulated settlement in
 * demo mode.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { getPublicUpiConfig, getUpiServerConfig } from "./server-config";
import {
    createGatewayOrder,
    fetchGatewayPayment,
    verifyCheckoutSignature,
    type GatewayPayment,
} from "./server-gateway";
import {
    attachGatewayOrder,
    createUpiOrder,
    getUpiOrder,
    markOrderFailed,
    markOrderPaid,
    type UpiOrder,
} from "./server-store";
import {
    ethToInr,
    inrToPaise,
    type PolicyDraft,
    type UpiConfigView,
    type UpiOrderView,
} from "./types";

/** Mirrors the buy-page limits so a crafted request cannot order a wild policy. */
const policyDraftSchema = z.object({
    locationName: z.string().trim().min(1).max(120),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    thresholdMm: z.number().min(5).max(400),
    coverageEth: z.number().min(0.01).max(2),
    premiumEth: z.number().positive().max(10),
});

export type UpiOrderResult =
    | { ok: true; order: UpiOrderView }
    | { ok: false; reason: string; order: UpiOrderView | null };

/** Strip the server-only fields before a view crosses to the browser. */
function toView(order: UpiOrder): UpiOrderView {
    return {
        orderId: order.id,
        status: order.status,
        amountInr: order.amountInr,
        amountEth: order.policyDraft.premiumEth,
        currency: "INR",
        mode: order.provider === "razorpay" ? "live" : "simulated",
        policyDraft: order.policyDraft,
        paymentRef: order.paymentRef,
        verification: order.verification,
        simulated: order.simulated,
        paidAt: order.paidAt,
        gatewayOrderId: order.gatewayOrderId,
        failureReason: order.failureReason,
    };
}

function reasonFrom(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}

/** Public, non-secret gateway configuration for the customer UI. */
export const getUpiConfig = createServerFn({ method: "GET" }).handler(
    async (): Promise<UpiConfigView> => getPublicUpiConfig(),
);

/**
 * Price a policy and open an order. In live mode this also opens the matching
 * order at the gateway; in demo mode it creates a simulated order that only
 * `simulateUpiPremiumPayment` can settle.
 */
export const createUpiPremiumOrder = createServerFn({ method: "POST" })
    .validator(z.object({ policyDraft: policyDraftSchema }))
    .handler(async ({ data }): Promise<UpiOrderResult> => {
        const config = getUpiServerConfig();
        const draft: PolicyDraft = data.policyDraft;
        const amountInr = ethToInr(draft.premiumEth, config.inrPerEth);

        if (amountInr <= 0) {
            return {
                ok: false,
                reason: "This premium is too small to charge in INR. Increase the coverage slightly.",
                order: null,
            };
        }

        const amountPaise = inrToPaise(amountInr);

        if (config.mode === "simulated") {
            const order = createUpiOrder({
                policyDraft: draft,
                amountInr,
                amountPaise,
                provider: "simulated",
            });
            return { ok: true, order: toView(order) };
        }

        const { keyId, keySecret } = config;
        if (!keyId || !keySecret) {
            return { ok: false, reason: "Payment gateway credentials are incomplete.", order: null };
        }

        const order = createUpiOrder({
            policyDraft: draft,
            amountInr,
            amountPaise,
            provider: "razorpay",
        });

        try {
            const gatewayOrder = await createGatewayOrder({
                keyId,
                keySecret,
                amountPaise,
                receipt: order.id,
                notes: {
                    skycoverOrderId: order.id,
                    location: draft.locationName,
                    coverageEth: String(draft.coverageEth),
                },
            });
            attachGatewayOrder(order.id, gatewayOrder.id);
            return { ok: true, order: toView(order) };
        } catch (error) {
            const reason = reasonFrom(error, "The payment gateway could not be reached.");
            const failed = markOrderFailed(order.id, reason);
            return { ok: false, reason, order: failed ? toView(failed) : null };
        }
    });

/**
 * Confirm a Checkout callback.
 *
 * Two independent checks are required before the order is marked paid:
 *   1. `razorpay_signature` must be a valid HMAC of `${order_id}|${payment_id}`
 *      keyed with the secret, which proves the callback came from the gateway;
 *   2. the gateway's own Payments API must report the payment, against this
 *      order, with a settled status and a matching amount.
 *
 * A browser redirect or a client-side "success" flag on its own therefore
 * cannot activate a policy.
 */
export const verifyUpiPremiumPayment = createServerFn({ method: "POST" })
    .validator(
        z.object({
            orderId: z.string().min(1),
            gatewayOrderId: z.string().min(1),
            paymentId: z.string().min(1),
            signature: z.string().min(1),
        }),
    )
    .handler(async ({ data }): Promise<UpiOrderResult> => {
        const config = getUpiServerConfig();
        const order = getUpiOrder(data.orderId);
        if (!order) {
            return {
                ok: false,
                reason: "This payment order is no longer held on the server. Please start the payment again.",
                order: null,
            };
        }

        if (config.mode !== "live" || !config.keyId || !config.keySecret) {
            return {
                ok: false,
                reason:
                    "This server has no live payment credentials, so a real payment cannot be verified. Use the simulated flow in demo mode.",
                order: toView(order),
            };
        }

        // Retried callbacks are fine: the order is already proven paid.
        if (order.status === "paid") return { ok: true, order: toView(order) };

        if (order.gatewayOrderId !== data.gatewayOrderId) {
            return {
                ok: false,
                reason: "This payment does not belong to the order being verified.",
                order: toView(order),
            };
        }

        const signatureValid = await verifyCheckoutSignature({
            gatewayOrderId: data.gatewayOrderId,
            paymentId: data.paymentId,
            signature: data.signature,
            keySecret: config.keySecret,
        });
        if (!signatureValid) {
            return {
                ok: false,
                reason: "The payment signature could not be verified, so the policy was not activated.",
                order: toView(order),
            };
        }

        let payment: GatewayPayment;
        try {
            payment = await fetchGatewayPayment({
                keyId: config.keyId,
                keySecret: config.keySecret,
                paymentId: data.paymentId,
            });
        } catch (error) {
            return {
                ok: false,
                reason: reasonFrom(error, "Could not confirm the payment with the gateway."),
                order: toView(order),
            };
        }

        if (payment.order_id !== order.gatewayOrderId) {
            return {
                ok: false,
                reason: "The gateway reports this payment against a different order.",
                order: toView(order),
            };
        }

        if (payment.status !== "captured") {
            return {
                ok: false,
                reason: `The gateway reports this payment as "${payment.status}", so it has not settled.`,
                order: toView(order),
            };
        }

        const result = markOrderPaid({
            orderId: order.id,
            paymentRef: payment.id,
            verification: "checkout_signature",
            simulated: false,
            amountPaise: payment.amount,
        });
        if (!result.ok) {
            return { ok: false, reason: result.reason, order: result.order ? toView(result.order) : null };
        }
        return { ok: true, order: toView(result.order) };
    });

/** Read-only status lookup, used when a customer returns to a pending order. */
export const getUpiPremiumOrder = createServerFn({ method: "GET" })
    .validator(z.object({ orderId: z.string().min(1) }))
    .handler(async ({ data }): Promise<UpiOrderView | null> => {
        const order = getUpiOrder(data.orderId);
        return order ? toView(order) : null;
    });

/**
 * Settle an order in demo mode.
 *
 * Refused outright when live credentials are configured, so a demo action can
 * never stand in for a real payment. The resulting order is flagged
 * `simulated: true` and its payment reference is deliberately not a gateway id.
 */
export const simulateUpiPremiumPayment = createServerFn({ method: "POST" })
    .validator(z.object({ orderId: z.string().min(1) }))
    .handler(async ({ data }): Promise<UpiOrderResult> => {
        const config = getUpiServerConfig();
        if (config.mode === "live") {
            return {
                ok: false,
                reason:
                    "This server has live payment credentials configured, so the simulated UPI flow is disabled.",
                order: null,
            };
        }

        const order = getUpiOrder(data.orderId);
        if (!order) {
            return {
                ok: false,
                reason: "This simulated order is no longer held on the server. Please start again.",
                order: null,
            };
        }

        if (order.provider !== "simulated") {
            return {
                ok: false,
                reason: "Only simulated orders can be settled in demo mode.",
                order: toView(order),
            };
        }

        const result = markOrderPaid({
            orderId: order.id,
            paymentRef: `simulated:${order.id}`,
            verification: "simulated",
            simulated: true,
        });
        if (!result.ok) {
            return { ok: false, reason: result.reason, order: result.order ? toView(result.order) : null };
        }
        return { ok: true, order: toView(result.order) };
    });
