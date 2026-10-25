import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { UPI_WEBHOOK_PATH } from "./lib/upi/types";
import { handleUpiWebhook } from "./lib/upi/webhook";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// The UPI webhook is a plain HTTP endpoint rather than a routed page, and this
// TanStack Start version has no server-file-route API, so it is served from
// request middleware. It runs before csrfMiddleware on purpose: the gateway
// posts from its own servers, and the body must reach the handler untouched so
// the signature can be verified against the exact bytes that were signed.
const upiWebhookMiddleware = createMiddleware().server(async ({ request, pathname, next }) => {
  if (pathname !== UPI_WEBHOOK_PATH) return next();
  return handleUpiWebhook(request);
});

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware, upiWebhookMiddleware, csrfMiddleware],
}));
