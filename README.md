# SkyCover Rain Shield

Parametric rainfall insurance for farmers, homestays and tour guides. Premiums
can be paid with UPI; rainfall is verified from the Open-Meteo archive and
settlement runs against a Sepolia smart contract. MetaMask is optional and is
only needed for the on-chain demonstration track.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## UPI premium payments

Customers can browse, configure and pay for a policy without installing
MetaMask. MetaMask is kept as an optional second track for on-chain
demonstrations on the Sepolia testnet.

### How it works

1. `/buy` prices the policy with the existing premium engine
   (`src/lib/premium.ts`) and sends the draft to the server.
2. `createUpiPremiumOrder` opens an order on the server. In live mode it also
   opens a matching order at Razorpay (UPI first); otherwise it opens a
   simulated order.
3. The customer pays in the gateway's own checkout. SkyCover never sees or
   stores a **UPI PIN** — authentication happens inside the customer's UPI app.
4. The order is only marked paid after `verifyUpiPremiumPayment` proves it:
   `razorpay_signature` must be a valid HMAC of `${order_id}|${payment_id}`
   keyed with the key secret, **and** the gateway's Payments API must report the
   payment against that order with a settled status and a matching amount. A
   redirect or a client-side "success" flag can never activate a policy.
5. Razorpay also posts to `POST /api/upi/webhook`
   (`src/lib/upi/webhook.ts`). The body is read as **raw text** so the
   `x-razorpay-signature` HMAC can be checked against the exact bytes that were
   signed, and duplicate deliveries are absorbed (see below).
6. Only after the server confirms the payment does the policy get activated with
   its coverage period, rainfall trigger, premium and potential payout.

Endpoints live in `src/lib/upi/`. `src/start.ts` serves the webhook as request
middleware, because this TanStack Start version has no server-file-route API.

### Configuration

Copy `.env.example` to `.env` and fill it in. All gateway credentials are
server-side only; `getPublicUpiConfig()` is the single place that decides what
the browser is allowed to know (the publishable key id, and the *names* of any
missing variables — never their values).

Live mode requires **all three** of `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
and `RAZORPAY_WEBHOOK_SECRET`. Without the webhook secret a redirect could be
forged, so the app refuses to run live rather than guess.

Point the webhook endpoint in the Razorpay Dashboard at
`https://<your-domain>/api/upi/webhook` and subscribe to `payment.captured` and
`payment.failed`. `GET` on that path returns a small reachability probe.

### Demo mode (default when no credentials are set)

If the credentials are absent, or `UPI_DEMO_MODE=true`, the app runs a clearly
labelled simulated UPI flow: the premium is priced in INR, the checkout is
replaced by a "Simulate a successful UPI payment" button, and every resulting
policy is tagged `Simulated UPI` / `Demo payment`. Nothing contacts a bank, a
UPI app or the gateway, and the UI never claims a real payment occurred. The
simulated path is disabled automatically if live credentials are configured.

### Duplicate processing

`src/lib/upi/server-store.ts` is the single authority on whether a payment
happened:

- the same gateway payment id replayed onto the **same** order is a no-op
  (gateways retry webhooks);
- the same payment id applied to a **different** order is rejected, which is
  what stops one real payment activating two policies;
- a different payment id on an already-paid order is rejected;
- a captured amount that does not match the order amount is rejected.

### Limitations (please read before a live demo)

- **The order book is in memory.** Orders live in a module-level `Map`. That is
  honest for a single-process prototype, but it is not durable: a restart clears
  pending orders, and multi-instance or serverless deployments (the Nitro build
  targets a Cloudflare Worker) do not share it between isolates. A production
  deployment must replace it with a durable store (for example Postgres or
  Redis) and make `markOrderPaid` a single transaction.
- **Payouts are not bank transfers.** Eligible payouts are shown, and claiming
  one records the claim against the simulated demo ledger. Sending money to a
  bank account needs an authorised payout provider, which is not configured
  here — the UI says so and never claims a transfer was made.
- **The INR/ETH rate is fixed** (`UPI_INR_PER_ETH`, default 250000). It is a
  product configuration value, not a live FX rate, and the UI always shows the
  ETH premium alongside the INR charge.
- **Sepolia test ETH is not money.** The on-chain track on `/buy` is a separate,
  clearly labelled demonstration and is unrelated to a UPI premium.

