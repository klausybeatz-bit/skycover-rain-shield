/**
 * Server-only webhook endpoint for the UPI payment gateway.
 *
 * This runs as a raw HTTP handler (registered in src/start.ts as request
 * middleware, because this TanStack Start version has no server-file-route
 * API). That matters for correctness, not just style: the body must be read as
 * the *raw* text the gateway signed. Any framework that parses and
 * re-serialises JSON first would break the signature.
 *
 * Requests are therefore never trusted and never parsed before verification,
 * and a webhook can only ever *confirm* an order — it can never create one.
 */

import { findOrderByGatewayOrderId, markOrderFailed, markOrderPaid } from "./server-store";
import { getUpiServerConfig, liveModeMissing } from "./server-config";
import { UPI_WEBHOOK_PATH } from "./types";
import { verifyWebhookSignature } from "./server-gateway";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: {
      entity?: {
        id?: string;
        order_id?: string;
        status?: string;
        amount?: number;
        currency?: string;
        notes?: Record<string, unknown>;
      };
    };
  };
}

export async function handleUpiWebhook(request: Request): Promise<Response> {
  if (request.method === "GET") {
    // Reachability probe only. Exposes no secrets, just whether live mode is on.
    const config = getUpiServerConfig();
    return json({ endpoint: UPI_WEBHOOK_PATH, accepts: "POST", mode: config.mode });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const config = getUpiServerConfig();
  if (config.mode !== "live" || !config.webhookSecret) {
    // Without a webhook secret there is nothing that could make this request
    // trustworthy, so it is refused rather than guessed at.
    return json(
      {
        error: "Live UPI payments are not configured on this server, so webhooks cannot be verified.",
        missing: liveModeMissing(config),
      },
      503,
    );
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: "Unreadable request body" }, 400);
  }

  const signature = request.headers.get("x-razorpay-signature");
  const signatureValid = await verifyWebhookSignature(rawBody, signature, config.webhookSecret);
  if (!signatureValid) {
    return json({ error: "Invalid webhook signature" }, 401);
  }

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return json({ error: "Malformed JSON payload" }, 400);
  }

  const entity = body.payload?.payment?.entity;
  const gatewayOrderId = entity?.order_id;

  if (!entity?.id || !gatewayOrderId) {
    // Signed, but not a payment event we act on — acknowledge so the gateway
    // stops retrying.
    return json({ received: true, applied: false, reason: "Not a settlement event" });
  }

  const order = findOrderByGatewayOrderId(gatewayOrderId);
  if (!order) {
    // Signature is valid but this order belongs to another instance or was
    // already swept. Acknowledge and let the client-side verification path or a
    // durable store reconcile it.
    return json({ received: true, applied: false, reason: "Unknown order" });
  }

  if (body.event === "payment.failed") {
    markOrderFailed(order.id, "The gateway reported the payment as failed");
    return json({ received: true, applied: true, status: "failed" });
  }

  if (entity.status !== "captured" && entity.status !== "authorized") {
    return json({ received: true, applied: false, status: entity.status ?? "unknown" });
  }

  const result = markOrderPaid({
    orderId: order.id,
    paymentRef: entity.id,
    verification: "webhook",
    simulated: false,
    amountPaise: entity.amount,
  });

  if (!result.ok) {
    // 200 on a duplicate so the gateway stops retrying; 409 on a genuine
    // conflict so a human notices.
    const status = result.reason.includes("already been used") ? 409 : 200;
    return json({ received: true, applied: false, reason: result.reason }, status);
  }

  return json({ received: true, applied: true, duplicate: result.duplicate });
}
