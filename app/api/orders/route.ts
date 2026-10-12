// /api/orders — escrow lifecycle via PayPal authorize-then-capture, persisted
// through the SQLite DB layer (lib/db/client).
//
//   POST  { datasetId, amount, currency?, referenceId?, buyerEmail? }
//         -> create an Orders v2 order (intent=AUTHORIZE) AND an `orders` row
//            (status MATCHED). Returns the DB `orderId`, the `paypalOrderId`,
//            and the approve URL.
//   PATCH { orderId, action, resolution?, requestId? }
//         action: authorize | deliver | capture | payout | void | dispute
//                 | resolve  (resolve needs resolution: "capture" | "void")
//         -> advance the escrow. The stored row is the source of truth: `from`
//            state and the PayPal ids come from the DB, not the caller. The
//            state-machine transition is validated BEFORE any PayPal call, so an
//            illegal move never charges anyone and never writes. On success the
//            new state (and any produced id) is persisted via `advanceOrder`,
//            which re-runs the transition inside the write — the DB can never
//            hold a state the machine would not allow.
//
// MOCK MODE: set PAYPAL_MODE=mock to drive the whole arc with no credentials.
// It still persists to the DB — the demo gets real, queryable order rows with
// mock PayPal ids. It is opt-in — without the flag, missing creds still 503.
import { payPalClientFromEnv, PayPalError } from "../../../lib/paypal/client";
import {
  transition,
  InvalidTransitionError,
  isEscrowState,
  type EscrowEvent,
} from "../../../lib/escrow/state-machine";
import {
  withDb,
  createOrder,
  getOrder,
  getDataset,
  advanceOrder,
  listOrders,
  type OrderPatch,
  type OrderFilter,
} from "../../../lib/db/client";
import { mockId, isMockMode } from "../../../lib/mock/ids";

// Buyer identity when the caller omits it (local demo — no auth layer yet).
const DEFAULT_BUYER_EMAIL = "demo-buyer@meddata.test";

const ACTION_EVENT: Record<string, EscrowEvent> = {
  authorize: "AUTHORIZE",
  deliver: "DELIVER",
  capture: "CAPTURE",
  payout: "PAYOUT",
  void: "VOID",
  dispute: "DISPUTE",
};

function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

function errorResponse(err: unknown): Response {
  if (err instanceof PayPalError) {
    return Response.json(
      { error: "PayPal request failed" },
      { status: err.status },
    );
  }
  if (err instanceof Error && err.message.includes("must be set")) {
    return Response.json(
      { error: "PayPal not configured (see .env.example)" },
      { status: 503 },
    );
  }
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
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  try {
    if (id !== null) {
      const order = withDb((db) => getOrder(db, id));
      if (!order) return bad(`unknown orderId: ${id}`, 404);
      return Response.json({ order });
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
  const datasetId = body?.datasetId;
  const amount = body?.amount;
  if (
    typeof datasetId !== "string" ||
    typeof amount !== "number" ||
    !(amount > 0)
  ) {
    return bad("datasetId (string) and amount (positive number) are required");
  }
  const buyerEmail =
    typeof body?.buyerEmail === "string" && body.buyerEmail.trim() !== ""
      ? body.buyerEmail
      : DEFAULT_BUYER_EMAIL;
  const amountCents = Math.round(amount * 100);

  // The dataset must exist (orders.dataset_id is a FK) — turn a bad id into a
  // clean 422 instead of a DB-level foreign-key throw.
  let dataset;
  try {
    dataset = withDb((db) => getDataset(db, datasetId));
  } catch (err) {
    return errorResponse(err);
  }
  if (!dataset) return bad(`unknown datasetId: ${datasetId}`);

  // MOCK MODE (opt-in): no PayPal, but we DO persist — a real, queryable order
  // row with a mock PayPal order id.
  if (isMockMode()) {
    const paypalOrderId = mockId("MOCK-ORDER");
    const order = withDb((db) =>
      createOrder(db, {
        datasetId,
        buyerEmail,
        amountCents,
        paypalOrderId,
        status: "MATCHED",
      }),
    );
    return Response.json(
      {
        orderId: order.id,
        paypalOrderId,
        status: "CREATED",
        approveUrl: `https://sandbox.paypal.com/checkoutnow?token=${paypalOrderId}`,
        escrowState: order.status,
        mock: true,
      },
      { status: 201 },
    );
  }

  try {
    const pp = payPalClientFromEnv();
    const ppOrder = await pp.createAuthorizeOrder({
      amount,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      referenceId:
        typeof body?.referenceId === "string" ? body.referenceId : undefined,
    });
    // Persist only after PayPal confirms the order — no dangling rows.
    const order = withDb((db) =>
      createOrder(db, {
        datasetId,
        buyerEmail,
        amountCents,
        paypalOrderId: ppOrder.orderId,
        status: "MATCHED",
      }),
    );
    return Response.json(
      {
        orderId: order.id,
        paypalOrderId: ppOrder.orderId,
        status: ppOrder.status,
        approveUrl: ppOrder.approveUrl,
        escrowState: order.status,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const action = typeof body?.action === "string" ? body.action : undefined;

  // Resolve a dispute: "resolve" picks a direction (capture = vendor is paid,
  // void = buyer is released) and maps to the matching state-machine event.
  let event: EscrowEvent | undefined;
  if (action === "resolve") {
    const resolution = body?.resolution;
    if (resolution !== "capture" && resolution !== "void")
      return bad('resolve requires resolution: "capture" or "void"');
    event = resolution === "capture" ? "RESOLVE_CAPTURE" : "RESOLVE_VOID";
  } else if (action) {
    event = ACTION_EVENT[action];
  }
  if (!event)
    return bad(
      `action must be one of: ${[...Object.keys(ACTION_EVENT), "resolve"].join(", ")}`,
    );

  const orderId = body?.orderId;
  if (typeof orderId !== "string" || orderId.trim() === "")
    return bad("orderId is required");

  // The stored row is the source of truth for `from` state and the PayPal ids.
  let order;
  try {
    order = withDb((db) => getOrder(db, orderId));
  } catch (err) {
    return errorResponse(err);
  }
  if (!order) return bad(`unknown orderId: ${orderId}`, 404);

  // Validate the transition BEFORE any PayPal call so an illegal move never
  // charges anyone. (advanceOrder re-validates inside the write as well.)
  try {
    transition(order.status, event);
  } catch (err) {
    if (err instanceof InvalidTransitionError)
      return Response.json({ error: err.message }, { status: 409 });
    return errorResponse(err);
  }

  // Persist the advance (optionally patching PayPal ids) once the money move
  // below has succeeded.
  const advance = (patch?: OrderPatch) =>
    withDb((db) => advanceOrder(db, orderId, event, patch));

  // DELIVER and DISPUTE are internal state changes — no PayPal, in either mode.
  if (event === "DELIVER" || event === "DISPUTE") {
    const row = advance();
    return Response.json({
      escrowState: row.status,
      ...(isMockMode() ? { mock: true } : {}),
    });
  }

  // MOCK MODE (opt-in): deterministic ids, no PayPal client, no network.
  if (isMockMode()) {
    if (event === "AUTHORIZE") {
      const authorizationId = mockId("MOCK-AUTH");
      const row = advance({ authorizationId });
      return Response.json({
        escrowState: row.status,
        authorizationId,
        status: "COMPLETED",
        mock: true,
      });
    }
    if (event === "CAPTURE" || event === "RESOLVE_CAPTURE") {
      const row = advance();
      return Response.json({
        escrowState: row.status,
        captureId: mockId("MOCK-CAP"),
        status: "COMPLETED",
        mock: true,
      });
    }
    if (event === "PAYOUT") {
      const row = advance();
      return Response.json({
        escrowState: row.status,
        payoutBatchId: mockId("MOCK-PAYOUT"),
        status: "PENDING",
        mock: true,
      });
    }
    // VOID or RESOLVE_VOID
    const row = advance();
    return Response.json({ escrowState: row.status, mock: true });
  }

  // REAL MODE: Payouts is the not-yet-built seam (deliberate, not a side effect).
  if (event === "PAYOUT")
    return Response.json(
      { error: "real PayPal Payouts not implemented" },
      { status: 501 },
    );

  try {
    const pp = payPalClientFromEnv();
    if (event === "AUTHORIZE") {
      if (!order.paypal_order_id)
        return bad("order has no PayPal order id to authorize", 409);
      const auth = await pp.authorizeOrder(order.paypal_order_id);
      const row = advance({ authorizationId: auth.authorizationId });
      return Response.json({
        escrowState: row.status,
        authorizationId: auth.authorizationId,
        status: auth.status,
      });
    }
    if (event === "CAPTURE" || event === "RESOLVE_CAPTURE") {
      if (!order.authorization_id)
        return bad("order has no authorization to capture", 409);
      const cap = await pp.captureAuthorization(order.authorization_id, {
        requestId:
          typeof body?.requestId === "string" ? body.requestId : undefined,
      });
      const row = advance();
      return Response.json({
        escrowState: row.status,
        captureId: cap.captureId,
        status: cap.status,
      });
    }
    // VOID or RESOLVE_VOID
    if (!order.authorization_id)
      return bad("order has no authorization to void", 409);
    await pp.voidAuthorization(order.authorization_id);
    const row = advance();
    return Response.json({ escrowState: row.status });
  } catch (err) {
    return errorResponse(err);
  }
}
