// /api/orders — escrow lifecycle via PayPal authorize-then-capture, persisted
// through the SQLite DB layer (lib/db/client).
//
//   POST  { datasetId, amount?, currency?, referenceId?, buyerEmail? }
//         -> create an Orders v2 order (intent=AUTHORIZE) AND an `orders` row
//            (status MATCHED). Returns the DB `orderId`, the `paypalOrderId`,
//            and the approve URL. The escrowed amount is ALWAYS the dataset's
//            listed price (datasets.price_cents), never a client figure: an
//            optional `amount` (major units) is only a confirmation, and a
//            mismatch is 422 so a tampered request can't escrow $0.01 for a
//            $49 dataset.
//   PATCH { orderId, action, resolution?, requestId?, note? }
//         action: authorize | deliver | capture | payout | void | dispute
//                 | cancel | resolve  (resolve needs resolution: "capture" |
//                 "void"; cancel is the buyer backing out of a MATCHED order
//                 before approving — any other state is 409)
//         note:   optional free-text context recorded on the audit event —
//                 a dispute reason on dispute, a resolution note on resolve.
//         -> advance the escrow. The stored row is the source of truth: `from`
//            state and the PayPal ids come from the DB, not the caller. The
//            state-machine transition is validated BEFORE any PayPal call, so an
//            illegal move never charges anyone and never writes.
//
// The business logic lives in lib/escrow/service.ts (framework-free, reused by
// the AI procurement agent); this file only maps HTTP <-> service.
//
// MOCK MODE: set PAYPAL_MODE=mock to drive the whole arc with no credentials.
// It still persists to the DB — the demo gets real, queryable order rows with
// mock PayPal ids. It is opt-in — without the flag, missing creds still 503.
import { isEscrowState } from "../../../lib/escrow/state-machine";
import {
  withDb,
  getOrder,
  listOrders,
  listOrderEvents,
  summarizeOrders,
  type OrderFilter,
} from "../../../lib/db/client";
import {
  createEscrowOrder,
  advanceEscrowOrder,
  EscrowError,
  type AdvanceEscrowOrderResult,
} from "../../../lib/escrow/service";

function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

function errorResponse(err: unknown): Response {
  if (err instanceof EscrowError) return bad(err.message, err.status);
  // Unexpected: log server-side, return a generic error (no internals leaked).
  console.error("orders route error:", err);
  return Response.json({ error: "internal error" }, { status: 500 });
}

// Read orders from the DB (no PayPal). Backs the UI's vendor incoming-orders
// view and dispute queue, and lets a view poll one order's state. Rows are the
// raw OrderRow (snake_case) incl. updated_at — the shape Terminal 2 consumes.
//
//   GET /api/orders            -> { orders: OrderRow[] }   (newest first)
//   GET /api/orders?status=DISPUTED&datasetId=..&buyerEmail=..  (AND filters)
//   GET /api/orders?id=ord_..  -> { order: OrderRow }  (404 if unknown)
//   GET /api/orders?summary=1[&datasetId=..]
//       -> { summary: OrderSummary }  vendor earnings roll-up: countsByStatus
//          (every EscrowState, zero-filled) plus heldCents (AUTHORIZED +
//          DELIVERED + DISPUTED — funds in escrow), capturedCents (CAPTURED +
//          PAID_OUT), paidOutCents (PAID_OUT), releasedCents (VOIDED).
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  try {
    // `?summary` (any value, like `?events`) returns the aggregate instead of
    // rows; `datasetId` scopes it to one listing.
    if (params.get("summary") !== null) {
      const datasetId = params.get("datasetId") || undefined;
      const summary = withDb((db) => summarizeOrders(db, { datasetId }));
      return Response.json({ summary });
    }
    if (id !== null) {
      // `?events` (any value) also returns the order's audit timeline. Order
      // and events are read in one DB open so they are a consistent snapshot.
      const includeEvents = params.get("events") !== null;
      const result = withDb((db) => {
        const order = getOrder(db, id);
        if (!order) return null;
        return includeEvents
          ? { order, events: listOrderEvents(db, id) }
          : { order };
      });
      if (!result) return bad(`unknown orderId: ${id}`, 404);
      return Response.json(result);
    }
    const status = params.get("status");
    if (status !== null && !isEscrowState(status))
      return bad(`unknown status: ${status}`);

    const filter: OrderFilter = {};
    if (status) filter.status = status;
    const datasetId = params.get("datasetId");
    if (datasetId) filter.datasetId = datasetId;
    const buyerEmail = params.get("buyerEmail");
    if (buyerEmail) filter.buyerEmail = buyerEmail;

    const orders = withDb((db) => listOrders(db, filter));
    return Response.json({ orders });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    // The service runtime-validates every field (the body is untrusted).
    const result = await createEscrowOrder({
      datasetId: body?.datasetId,
      amount: body?.amount,
      buyerEmail: body?.buyerEmail,
      currency: body?.currency,
      referenceId: body?.referenceId,
    });
    return Response.json(result, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH response body: the service result minus the full order row. */
function advanceBody({
  escrowState,
  authorizationId,
  captureId,
  payoutBatchId,
  status,
  mock,
}: AdvanceEscrowOrderResult) {
  return {
    escrowState,
    authorizationId,
    captureId,
    payoutBatchId,
    status,
    mock,
  };
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    const result = await advanceEscrowOrder({
      orderId: body?.orderId,
      action: body?.action,
      resolution: body?.resolution,
      note: body?.note,
      requestId: body?.requestId,
    });
    return Response.json(advanceBody(result));
  } catch (err) {
    return errorResponse(err);
  }
}
