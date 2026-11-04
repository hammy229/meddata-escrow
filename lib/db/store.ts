// Async application repository, shared by SQLite and PostgreSQL. The original
// synchronous client remains available for local fixtures and SQLite demo tools.
import { randomUUID } from "node:crypto";
import catalogMetadata from "../../data/catalog.json";
import { transaction, type AppDatabase } from "./connection";
import type {
  NewOrder,
  OrderRow,
  OrderFilter,
  DatasetRow,
  VendorRow,
  OrderPatch,
  OrderEventRow,
  WebhookEventRecord,
  OrderSummary,
} from "./client";
import type { NewUsage, UsageRow } from "./usage";
import type { Dataset } from "./datasets";
import { UnknownOrderError } from "./usage";
import {
  transition,
  ESCROW_STATES,
  InvalidTransitionError,
  type EscrowEvent,
  type EscrowState,
} from "../escrow/state-machine";
import { platformFeeCents, vendorPayoutCents } from "../escrow/fees";
import { DEFAULT_QUERY_CAP_CENTS } from "../query/pricing";
export { withDb } from "./connection";
export { UnknownOrderError } from "./usage";
export { PER_QUERY_FEE_CENTS } from "../query/pricing";
export type { AppDatabase } from "./connection";
export type {
  OrderRow,
  OrderFilter,
  DatasetRow,
  VendorRow,
  OrderPatch,
  OrderEventRow,
  OrderSummary,
} from "./client";
export type { UsageRow } from "./usage";
export type { Dataset } from "./datasets";

export async function getOrder(
  db: AppDatabase,
  id: string,
): Promise<OrderRow | undefined> {
  return (await db.prepare("SELECT * FROM orders WHERE id = ?").get(id)) as
    OrderRow | undefined;
}
export async function getDataset(
  db: AppDatabase,
  id: string,
): Promise<DatasetRow | undefined> {
  return (await db.prepare("SELECT * FROM datasets WHERE id = ?").get(id)) as
    DatasetRow | undefined;
}
export async function getVendor(
  db: AppDatabase,
  id: string,
): Promise<VendorRow | undefined> {
  return (await db.prepare("SELECT * FROM vendors WHERE id = ?").get(id)) as
    VendorRow | undefined;
}
export async function listOrders(
  db: AppDatabase,
  filter: OrderFilter = {},
): Promise<OrderRow[]> {
  const clauses: string[] = [],
    values: string[] = [];
  for (const [column, value] of [
    ["status", filter.status],
    ["dataset_id", filter.datasetId],
    ["buyer_email", filter.buyerEmail],
  ])
    if (value) {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  return (await db
    .prepare(
      `SELECT * FROM orders ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC`,
    )
    .all(...values)) as OrderRow[];
}
async function insertEvent(
  db: AppDatabase,
  id: string,
  event: string,
  from: EscrowState | null,
  to: EscrowState,
  note?: string,
): Promise<void> {
  const { n } = (await db
    .prepare(
      "SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM order_events WHERE order_id = ?",
    )
    .get(id)) as { n: number };
  await db
    .prepare(
      "INSERT INTO order_events (id, order_id, seq, event, from_state, to_state, note) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(`evt_${randomUUID()}`, id, Number(n), event, from, to, note ?? null);
}
export async function createOrder(
  db: AppDatabase,
  input: NewOrder,
): Promise<OrderRow> {
  return transaction(db, async () => {
    const id = input.id ?? `ord_${randomUUID()}`,
      status = input.status ?? "MATCHED";
    await db
      .prepare(
        "INSERT INTO orders (id, dataset_id, buyer_email, account_id, paypal_order_id, authorization_id, status, amount_cents, query_cap_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.datasetId,
        input.buyerEmail,
        input.accountId ?? null,
        input.paypalOrderId ?? null,
        input.authorizationId ?? null,
        status,
        input.amountCents,
        input.queryCapCents ?? DEFAULT_QUERY_CAP_CENTS,
      );
    await insertEvent(db, id, "CREATE", null, status);
    return (await getOrder(db, id))!;
  });
}
export async function advanceOrder(
  db: AppDatabase,
  id: string,
  event: EscrowEvent,
  patch?: OrderPatch,
  note?: string,
): Promise<OrderRow> {
  return transaction(db, async () => {
    const current = (await db
      .prepare(
        `SELECT * FROM orders WHERE id = ?${db.dialect === "postgres" ? " FOR UPDATE" : ""}`,
      )
      .get(id)) as OrderRow | undefined;
    if (!current) throw new Error(`Order not found: ${id}`);
    const next = transition(current.status, event);
    const sets = ["status = ?", "updated_at = CURRENT_TIMESTAMP"],
      values: (string | number | null)[] = [next];
    for (const [field, column] of [
      ["paypalOrderId", "paypal_order_id"],
      ["authorizationId", "authorization_id"],
      ["payoutBatchId", "payout_batch_id"],
    ] as const)
      if (patch && field in patch) {
        sets.push(`${column} = ?`);
        values.push(patch[field] ?? null);
      }
    for (const [field, column] of [
      ["amountCents", "amount_cents"],
      ["refundedCents", "refunded_cents"],
    ] as const)
      if (patch?.[field] !== undefined) {
        sets.push(`${column} = ?`);
        values.push(patch[field]);
      }
    await db
      .prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`)
      .run(...values, id);
    await insertEvent(db, id, event, current.status, next, note);
    return (await getOrder(db, id))!;
  });
}
/** Store a split offer on a disputed order, with its own audit row. */
export async function recordSplitOffer(
  db: AppDatabase,
  id: string,
  offer: { captureCents: number; by: string; note: string },
): Promise<OrderRow> {
  return transaction(db, async () => {
    const current = (await db
      .prepare(
        `SELECT * FROM orders WHERE id = ?${db.dialect === "postgres" ? " FOR UPDATE" : ""}`,
      )
      .get(id)) as OrderRow | undefined;
    if (!current) throw new Error(`Order not found: ${id}`);
    if (current.status !== "DISPUTED")
      throw new InvalidTransitionError(current.status, "RESOLVE_SPLIT");
    await db
      .prepare(
        "UPDATE orders SET split_offer_cents = ?, split_offer_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      )
      .run(offer.captureCents, offer.by, id);
    await insertEvent(
      db,
      id,
      "PROPOSE_SPLIT",
      current.status,
      current.status,
      offer.note,
    );
    return (await getOrder(db, id))!;
  });
}
export async function listOrderEvents(
  db: AppDatabase,
  id: string,
): Promise<OrderEventRow[]> {
  return (await db
    .prepare("SELECT * FROM order_events WHERE order_id = ? ORDER BY seq ASC")
    .all(id)) as OrderEventRow[];
}
export async function findOrderByPayPalRef(
  db: AppDatabase,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<OrderRow | undefined> {
  const refs = [...new Set(ids.filter((id): id is string => !!id))];
  if (!refs.length) return undefined;
  const marks = refs.map(() => "?").join(", ");
  return (await db
    .prepare(
      `SELECT * FROM orders WHERE authorization_id IN (${marks}) OR paypal_order_id IN (${marks}) OR payout_batch_id IN (${marks}) OR id IN (${marks}) ORDER BY created_at DESC, id DESC LIMIT 1${db.dialect === "postgres" ? " FOR UPDATE" : ""}`,
    )
    .get(...refs, ...refs, ...refs, ...refs)) as OrderRow | undefined;
}
export async function recordWebhookEvent(
  db: AppDatabase,
  event: WebhookEventRecord,
): Promise<boolean> {
  return (
    (
      await db
        .prepare(
          "INSERT INTO paypal_webhook_events (id, event_type, resource_id, order_id) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
        )
        .run(
          event.id,
          event.eventType,
          event.resourceId ?? null,
          event.orderId ?? null,
        )
    ).changes > 0
  );
}
export async function summarizeOrders(
  db: AppDatabase,
  filter: { datasetId?: string } = {},
): Promise<OrderSummary> {
  const orders = await listOrders(db, filter);
  const countsByStatus = Object.fromEntries(
    ESCROW_STATES.map((s) => [s, 0]),
  ) as Record<EscrowState, number>;
  for (const order of orders) countsByStatus[order.status]++;
  const sum = (states: string[]) =>
    orders
      .filter((o) => states.includes(o.status))
      .reduce((n, o) => n + o.amount_cents, 0);
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
    releasedCents:
      sum(["VOIDED"]) + orders.reduce((n, o) => n + (o.refunded_cents ?? 0), 0),
  };
}
export async function listUsage(
  db: AppDatabase,
  id: string,
): Promise<UsageRow[]> {
  return (await db
    .prepare(
      "SELECT * FROM query_usage WHERE order_id = ? ORDER BY created_at DESC, id DESC",
    )
    .all(id)) as UsageRow[];
}
export async function queryCapStatus(
  db: AppDatabase,
  order: { id: string; query_cap_cents: number },
  fee: number,
) {
  const row = (await db
    .prepare(
      "SELECT COALESCE(SUM(charge_cents), 0) AS total FROM query_usage WHERE order_id = ?",
    )
    .get(order.id)) as { total: string | number };
  const spentCents = Number(row.total);
  return {
    exceeded: spentCents + fee > order.query_cap_cents,
    spentCents,
    capCents: order.query_cap_cents,
  };
}
export async function recordUsage(
  db: AppDatabase,
  input: NewUsage,
): Promise<UsageRow> {
  return transaction(db, async () => {
    const order = (await db
      .prepare(
        `SELECT * FROM orders WHERE id = ?${db.dialect === "postgres" ? " FOR UPDATE" : ""}`,
      )
      .get(input.orderId)) as OrderRow | undefined;
    if (!order) throw new UnknownOrderError(input.orderId);
    if ((await queryCapStatus(db, order, input.chargeCents)).exceeded)
      throw new Error("Query spend cap reached");
    const id = input.id ?? `qu_${randomUUID()}`;
    await db
      .prepare(
        "INSERT INTO query_usage (id, order_id, question, charge_cents) VALUES (?, ?, ?, ?)",
      )
      .run(id, input.orderId, input.question, input.chargeCents);
    return (await db
      .prepare("SELECT * FROM query_usage WHERE id = ?")
      .get(id)) as UsageRow;
  });
}
function meta() {
  return new Map(
    (
      catalogMetadata as { id: string; tags?: string[]; recordCount?: number }[]
    ).map((d) => [d.id, d]),
  );
}
export async function listDatasets(db: AppDatabase): Promise<Dataset[]> {
  const metadata = meta();
  const rows = (await db
    .prepare(
      `SELECT * FROM datasets ORDER BY created_at ASC, ${db.dialect === "sqlite" ? "rowid" : "id"} ASC`,
    )
    .all()) as (DatasetRow & {
    tags_json?: string;
    record_count?: number | null;
  })[];
  return rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    title: r.title,
    description: r.description,
    priceCents: r.price_cents,
    tags: r.tags_json
      ? JSON.parse(r.tags_json)
      : (metadata.get(r.id)?.tags ?? []),
    recordCount: r.record_count ?? metadata.get(r.id)?.recordCount ?? null,
  }));
}
export async function updateDatasetPrice(
  db: AppDatabase,
  id: string,
  price: number,
): Promise<Dataset | undefined> {
  await db
    .prepare("UPDATE datasets SET price_cents = ? WHERE id = ?")
    .run(price, id);
  return (await listDatasets(db)).find((d) => d.id === id);
}
export async function priceMap(db: AppDatabase): Promise<Map<string, number>> {
  return new Map((await listDatasets(db)).map((d) => [d.id, d.priceCents]));
}
