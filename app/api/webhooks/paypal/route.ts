// /api/webhooks/paypal — inbound PayPal webhook receiver.
//
//   POST (PayPal-signed JSON event)
//     401 { error }                      signature not verified (nothing done)
//     200 { duplicate: true }            event id already processed (replay)
//     200 { ignored: true, reason }      unknown type / no matching order /
//                                        transition not legal from the state
//     200 { received: true, recorded }   relevant event, no state change
//     200 { received: true, applied, orderId, escrowState }
//
// The raw body is read once and verified with PayPal's
// verify-webhook-signature (PAYPAL_WEBHOOK_ID) before it is trusted. After
// verification the answer is always 200 — even for events we can't map — so
// PayPal doesn't retry forever; mapping problems are logged instead. Only an
// unexpected internal failure (e.g. the DB is down) is a 500, which PayPal
// retries; the event-id ledger makes that retry safe.
//
// Demo only: with PAYPAL_MODE=mock, an event is accepted iff it carries the
// header `x-mock-webhook: 1` (no PayPal account needed).
import { verifyPayPalWebhook } from "../../../../lib/paypal/client";
import { processPayPalWebhookEvent } from "../../../../lib/escrow/paypal-webhooks";

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!(await verifyPayPalWebhook(request.headers, rawBody)))
    return Response.json(
      { error: "webhook signature not verified" },
      { status: 401 },
    );

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Unreachable for a PayPal-verified body; mock-mode demo typo.
    console.warn("paypal webhook: verified body is not JSON");
    return Response.json({ ignored: true, reason: "body is not JSON" });
  }

  try {
    const outcome = processPayPalWebhookEvent(payload);
    switch (outcome.kind) {
      case "duplicate":
        return Response.json({ duplicate: true });
      case "ignored":
        return Response.json({ ignored: true, reason: outcome.reason });
      case "recorded":
        return Response.json({
          received: true,
          recorded: true,
          orderId: outcome.orderId,
          escrowState: outcome.state,
        });
      case "applied":
        return Response.json({
          received: true,
          applied: outcome.event,
          orderId: outcome.order.id,
          escrowState: outcome.to,
        });
    }
  } catch (err) {
    console.error("paypal webhook processing error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
