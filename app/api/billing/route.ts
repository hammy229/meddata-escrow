// POST /api/billing  { orderId, question, chargeCents? }
// Records one per-query usage row (lib/db/usage) after a successful
// /api/query, always at the server-set PER_QUERY_FEE_CENTS. The caller does not
// pick the price: `chargeCents` is accepted only as a confirmation, and a value
// that differs from the fee is 422 — rejected rather than silently ignored, so a
// stale or tampered client finds out instead of assuming free queries. Only an
// order whose escrow state grants data access (DELIVERED / CAPTURED / PAID_OUT,
// see grantsDataAccess) can be billed; anything else is 409. This is the seam
// where the real PayPal per-query capture would fire (authorize-then-capture
// against the escrowed order) — mocked here, no network.
import {
  recordUsage,
  withDb,
  UnknownOrderError,
  PER_QUERY_FEE_CENTS,
  type UsageRow,
} from "../../../lib/db/usage";
import { getOrder } from "../../../lib/db/client";
import { grantsDataAccess } from "../../../lib/escrow/state-machine";

// Same error shape as /api/orders: { error }.
function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const orderId = body?.orderId;
  const question = body?.question;
  if (
    typeof orderId !== "string" ||
    orderId.trim() === "" ||
    typeof question !== "string" ||
    question.trim() === ""
  ) {
    return bad("orderId and question (non-empty strings) are required");
  }
  if (
    body?.chargeCents !== undefined &&
    body.chargeCents !== PER_QUERY_FEE_CENTS
  ) {
    return bad(
      `chargeCents is set by the server (per-query fee is ${PER_QUERY_FEE_CENTS})`,
    );
  }
  const chargeCents = PER_QUERY_FEE_CENTS;

  try {
    // Access check and write share one DB open, so the state that was checked
    // is the state the usage row is recorded against.
    const result: UsageRow | Response = withDb((db) => {
      const order = getOrder(db, orderId);
      if (!order) return bad("unknown orderId");
      if (!grantsDataAccess(order.status))
        return bad(
          `order is ${order.status}; queries are billable only once data access is granted`,
          409,
        );
      return recordUsage(db, { orderId, question, chargeCents });
    });
    if (result instanceof Response) return result;

    // SEAM: real PayPal per-query capture would fire here against the escrowed
    // order (lib/paypal/client). Mocked for the demo — no money moves.
    const charged = { charged: true, chargeCents };

    return Response.json(
      {
        usageId: result.id,
        orderId: result.order_id,
        chargeCents: result.charge_cents,
        charged: charged.charged,
      },
      { status: 201 },
    );
  } catch (err) {
    // Defensive: a missing order is bad input (422), not a server error.
    if (err instanceof UnknownOrderError) {
      return bad("unknown orderId");
    }
    throw err;
  }
}
