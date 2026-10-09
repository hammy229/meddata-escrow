// POST /api/billing  { orderId, question, chargeCents? }
// Records one per-query usage row (lib/db/usage) after a successful
// /api/query, defaulting to a small fixed per-query fee when chargeCents is
// omitted. This is the seam where the real PayPal per-query capture would fire
// (authorize-then-capture against the escrowed order) — mocked here, no network.
import { recordUsage, withDb, UnknownOrderError } from "../../../lib/db/usage";

// Fixed per-query fee (cents) when the caller does not specify one.
const DEFAULT_CHARGE_CENTS = 50;

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
  const chargeCents =
    typeof body?.chargeCents === "number" && body.chargeCents >= 0
      ? Math.round(body.chargeCents)
      : DEFAULT_CHARGE_CENTS;

  try {
    const usage = withDb((db) =>
      recordUsage(db, { orderId, question, chargeCents }),
    );

    // SEAM: real PayPal per-query capture would fire here against the escrowed
    // order (lib/paypal/client). Mocked for the demo — no money moves.
    const charged = { charged: true, chargeCents };

    return Response.json(
      {
        usageId: usage.id,
        orderId: usage.order_id,
        chargeCents: usage.charge_cents,
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
