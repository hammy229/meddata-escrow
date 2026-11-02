import { getDataset } from "../../../lib/db/store";
import { arbitrate } from "../../../lib/ai/arbiter";
import { checkSample } from "../../../lib/ai/sample-check";
import { generateDua } from "../../../lib/escrow/dua";
import { getVendor } from "../../../lib/db/store";
import { listDatasets } from "../../../lib/db/store";
import { ESCROW_STATES } from "../../../lib/escrow/state-machine";
import { vendorPayoutCents, platformFeeCents } from "../../../lib/escrow/fees";
import type { Account } from "../../../lib/auth/store";
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
//            $49 dataset. If the same buyer already has a MATCHED (not yet
//            approved) order for the dataset, that order is returned with
//            `reused: true` and HTTP 200 instead of 201 — no duplicate.
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
import {
  isEscrowState,
  grantsDataAccess,
} from "../../../lib/escrow/state-machine";
import { presignDelivery } from "../../../lib/delivery/mock-s3";
import {
  withDb,
  getOrder,
  listOrders,
  listOrderEvents,
  summarizeOrders,
  type OrderFilter,
} from "../../../lib/db/store";
import { authorizationWindow } from "../../../lib/escrow/auth-window";
import { buildReceipt } from "../../../lib/escrow/receipt";
import { listUsage } from "../../../lib/db/store";
import {
  createEscrowOrder,
  advanceEscrowOrder,
  EscrowError,
  type AdvanceEscrowOrderResult,
} from "../../../lib/escrow/service";
// States where PayPal is still holding the buyer's funds (not yet captured).
const HELD_STATES: ReadonlySet<string> = new Set([
  "AUTHORIZED",
  "DELIVERED",
  "DISPUTED",
]);
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
//       The order also carries `authorization`: the PayPal hold window
//       ({ authorizedAt, honorUntil, expiresAt, state, daysLeft }, see
//       lib/escrow/auth-window) while funds are held (AUTHORIZED, DELIVERED,
//       DISPUTED), measured from the AUTHORIZE event; otherwise null.
//   GET /api/orders?id=ord_..&receipt=1
//       -> { order, receipt }  fee breakdown (lib/escrow/receipt): amount,
//          platform fee, vendor payout, per-query charges and the total. All
//          money fields are 0 for a VOIDED or CANCELLED order.
//   GET /api/orders?summary=1[&datasetId=..]
//       -> { summary: OrderSummary }  vendor earnings roll-up: countsByStatus
//          (every EscrowState, zero-filled) plus heldCents (AUTHORIZED +
//          DELIVERED + DISPUTED — funds in escrow), capturedCents (CAPTURED +
//          PAID_OUT), paidOutCents (PAID_OUT), releasedCents (VOIDED).
export async function GET(request: Request, account?: Account) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  try {
    // `?summary` (any value, like `?events`) returns the aggregate instead of
    // rows; `datasetId` scopes it to one listing.
    if (params.get("summary") !== null) {
      const datasetId = params.get("datasetId") || undefined;
      const summary = await withDb(async (db) => {
        if (!account) return await summarizeOrders(db, { datasetId });
        const ids = (await scopedOrders(db, account)).filter(
          (o) => !datasetId || o.dataset_id === datasetId,
        );
        return summarizeAccountOrders(ids);
      });
      return Response.json({ summary });
    }
    if (id !== null) {
      // `?events` (any value) also returns the order's audit timeline. Order
      // and events are read in one DB open so they are a consistent snapshot.
      const includeEvents = params.get("events") !== null;
      if (params.get("arbitrate") !== null) {
        const found = await withDb(async (db) => {
          const order = await getOrder(db, id);
          return order && { order, events: await listOrderEvents(db, id) };
        });
        if (!found) return bad(`unknown orderId: ${id}`, 404);
        if (found.order.status !== "DISPUTED")
          return bad(
            `order is ${found.order.status}; only DISPUTED orders can be arbitrated`,
            409,
          );
        const sample = await checkSample(found.order.dataset_id).catch(
          () => null,
        );
        const recommendation = await arbitrate({
          order: found.order,
          events: found.events,
          sample,
        });
        return Response.json({ order: found.order, recommendation });
      }
      if (params.get("receipt") !== null) {
        const found = await withDb(async (db) => {
          const order = await getOrder(db, id);
          if (!order) return null;
          const dataset = await getDataset(db, order.dataset_id);
          const vendor = dataset && (await getVendor(db, dataset.vendor_id));
          return { order, usage: await listUsage(db, id), dataset, vendor };
        });
        if (!found) return bad(`unknown orderId: ${id}`, 404);
        const dua = generateDua({
          orderId: found.order.id,
          datasetId: found.order.dataset_id,
          datasetTitle: found.dataset?.title ?? found.order.dataset_id,
          vendorName: found.vendor?.name ?? "Unknown vendor",
          buyerEmail: found.order.buyer_email,
          amountCents: found.order.amount_cents,
          issuedAt: found.order.created_at,
        });
        return Response.json({
          order: found.order,
          receipt: buildReceipt(found.order, found.usage),
          dua,
        });
      }
      const result = await withDb(async (db) => {
        const order = await getOrder(db, id);
        if (!order) return null;
        const events = await listOrderEvents(db, id);
        const authorization = HELD_STATES.has(order.status)
          ? authorizationWindow(
              events.find((e) => e.event === "AUTHORIZE")?.created_at,
            )
          : null;
        // A fresh expiring link per read, only once the buyer may have the data.
        const delivery = grantsDataAccess(order.status)
          ? presignDelivery(order.dataset_id, { orderId: order.id })
          : null;
        return includeEvents
          ? { order, authorization, delivery, events }
          : { order, authorization, delivery };
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
    const orders = await withDb(async (db) => {
      const rows = await listOrders(db, filter);
      if (!account) return rows;
      if (account.role === "researcher")
        return rows.filter((o) => o.account_id === account.id);
      const datasets = await listDatasets(db);
      const owned = new Set(
        datasets
          .filter((d) => d.vendorId === account.vendor_id)
          .map((d) => d.id),
      );
      return rows.filter((o) => owned.has(o.dataset_id));
    });
    return Response.json({ orders });
  } catch (err) {
    return errorResponse(err);
  }
}
export async function POST(request: Request, account?: Account) {
  const body = await request.json().catch(() => null);
  try {
    // The service runtime-validates every field (the body is untrusted).
    const result = await createEscrowOrder({
      datasetId: body?.datasetId,
      amount: body?.amount,
      buyerEmail: account?.email ?? body?.buyerEmail,
      accountId: account?.id,
      currency: body?.currency,
      referenceId: body?.referenceId,
      queryCapCents: body?.queryCapCents,
      origin: new URL(request.url).origin,
    });
    // 200 when an existing unapproved order is returned (`reused: true`).
    return Response.json(result, { status: result.reused ? 200 : 201 });
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
async function scopedOrders(
  db: import("../../../lib/db/connection").AppDatabase,
  account: Account,
) {
  const rows = await listOrders(db);
  if (account.role === "researcher")
    return rows.filter((o) => o.account_id === account.id);
  const datasets = await listDatasets(db);
  const owned = new Set(
    datasets.filter((d) => d.vendorId === account.vendor_id).map((d) => d.id),
  );
  return rows.filter((o) => owned.has(o.dataset_id));
}
function summarizeAccountOrders(
  orders: import("../../../lib/db/store").OrderRow[],
) {
  const countsByStatus = Object.fromEntries(
    ESCROW_STATES.map((s) => [s, 0]),
  ) as Record<import("../../../lib/escrow/state-machine").EscrowState, number>;
  const sum = (states: string[]) =>
    orders
      .filter((o) => states.includes(o.status))
      .reduce((n, o) => n + o.amount_cents, 0);
  for (const order of orders) countsByStatus[order.status]++;
  const paid = orders.filter((o) => o.status === "PAID_OUT");
  return {
    countsByStatus,
    heldCents: sum(["AUTHORIZED", "DELIVERED", "DISPUTED"]),
    capturedCents: sum(["CAPTURED", "PAID_OUT"]),
    paidOutCents: sum(["PAID_OUT"]),
    vendorPaidOutCents: paid.reduce(
      (n, o) => n + vendorPayoutCents(o.amount_cents),
      0,
    ),
    platformFeeCents: paid.reduce(
      (n, o) => n + platformFeeCents(o.amount_cents),
      0,
    ),
    releasedCents: sum(["VOIDED"]),
  };
}
