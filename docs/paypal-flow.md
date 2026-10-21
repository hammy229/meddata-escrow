# PayPal Escrow Flow

Uses the PayPal Orders v2 / Payments API in **sandbox**. Escrow is implemented
with authorize-then-capture: funds are held at authorization and only captured
if the automated sample check passes.

## 1. Authorize

Create an order with `intent: AUTHORIZE` and authorize it. Funds are _held_ on
the buyer's account but not captured. See `authorizeOrder` in
[`../lib/paypal/client.ts`](../lib/paypal/client.ts).

## 2. Sample check

The AI agent runs a quality + privacy check on a sample of the matched dataset.
The result decides capture vs. void.

## 3. Capture (sample passes)

Capture the authorization to complete the purchase. See `captureAuthorization`.

## 4. Void / refund (sample fails)

Void the authorization so the buyer is never charged. See `voidAuthorization`.

## 4b. Vendor payout (after capture)

`PATCH /api/orders { action: "payout" }` pays the dataset's vendor through the
PayPal **Payouts API** (`createPayout`, `POST /v1/payments/payouts`) at the
vendor's `vendors.payout_email`. The vendor receives the captured amount
minus the platform fee: `PLATFORM_FEE_BPS = 1000` (10%) in
[`../lib/escrow/fees.ts`](../lib/escrow/fees.ts), fee rounded to the cent.
`sender_batch_id` is `payout_<orderId>`, so an order can only ever be paid out
once; the returned `payout_batch_id` is stored on the order. A vendor with no
payout email gets a 409 and nothing is sent.

Every mutating PayPal call carries a `PayPal-Request-Id` derived from our order
id + operation (e.g. `ord_…:capture`), so a retried request replays PayPal's
first result instead of moving money twice.

## 5. Per-query billing

After purchase, each plain-English query is metered and charged individually.
See `chargePerQuery` and [`../app/api/billing`](../app/api/billing).

## Endpoints

| App route           | PayPal action            |
| ------------------- | ------------------------ |
| `POST /api/orders`  | create order + authorize |
| `PATCH /api/orders` | capture **or** void      |
| `PATCH /api/orders` | payout (Payouts API)     |
| `POST /api/billing` | per-query charge         |
