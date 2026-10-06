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

## 5. Per-query billing

After purchase, each plain-English query is metered and charged individually.
See `chargePerQuery` and [`../app/api/billing`](../app/api/billing).

## Endpoints

| App route           | PayPal action            |
| ------------------- | ------------------------ |
| `POST /api/orders`  | create order + authorize |
| `PATCH /api/orders` | capture **or** void      |
| `POST /api/billing` | per-query charge         |
