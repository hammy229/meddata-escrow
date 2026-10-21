// SQLite persistence layer for the escrow lifecycle.
//
// Uses Node's built-in `node:sqlite` (no npm driver, no native build). The
// escrow state machine (lib/escrow/state-machine.ts) is the source of truth:
// `advanceOrder` applies an event through `transition()`, so an illegal move
// throws InvalidTransitionError BEFORE any UPDATE runs and the DB can never
// hold a state the machine would not allow.
//
// SQL is kept portable (TEXT ids, ON CONFLICT upserts) so the same schema runs
// on Postgres in production; only the driver here is SQLite-specific.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import {
  transition,
  ESCROW_STATES,
  type EscrowState,
  type EscrowEvent,
} from "../escrow/state-machine";

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");

/** A persisted order row (snake_case columns, as stored). */
export interface OrderRow {
  id: string;
  dataset_id: string;
  buyer_email: string;
  paypal_order_id: string | null;
  authorization_id: string | null;
  /** PayPal Payouts batch id, set when the vendor is paid (PAYOUT). */
  payout_batch_id: string | null;
  status: EscrowState;
  amount_cents: number;
  created_at: string;
  /** Null only for rows created before the column existed (guarded ALTER). */
  updated_at: string | null;
}

/**
 * A persisted order-event row (snake_case columns, as stored). One row per
 * lifecycle transition, append-only. `from_state` is null for the genesis
 * (CREATE) row; `event` is "CREATE" there, otherwise the EscrowEvent.
 */
export interface OrderEventRow {
  id: string;
  order_id: string;
  /** Monotonic per-order position (0 = genesis); the timeline's ordering key. */
  seq: number;
  event: string;
  from_state: EscrowState | null;
  to_state: EscrowState;
  /** Free-text context (dispute reason / resolution note); null when routine. */
  note: string | null;
  created_at: string;
}

/** Fields accepted when creating an order. */
export interface NewOrder {
  datasetId: string;
  buyerEmail: string;
  amountCents: number;
  /** Defaults to a generated `ord_<uuid>`. */
  id?: string;
  /** Initial escrow state; defaults to MATCHED (just matched, not yet paid). */
  status?: EscrowState;
  paypalOrderId?: string | null;
  authorizationId?: string | null;
}

/**
 * Resolve a filesystem path from a DATABASE_URL-style value.
 * Honors the `file:` convention from .env.example; defaults to the dev DB.
 * `:memory:` is passed through for ephemeral (test) databases.
 */
export function resolveDbPath(
  url: string | undefined = process.env.DATABASE_URL,
): string {
  if (!url) return "./data/dev.sqlite";
  if (url === ":memory:") return ":memory:";
  return url.startsWith("file:") ? url.slice("file:".length) : url;
}

/** Apply schema.sql (idempotent — every statement is CREATE TABLE IF NOT EXISTS). */
export function migrate(db: DatabaseSync): void {
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  // Back-fill columns added after a DB was first created. SQLite disallows a
  // non-constant DEFAULT on ADD COLUMN, so the column is nullable here; new
  // writes set it explicitly (createOrder/advanceOrder) and fresh DBs get the
  // CURRENT_TIMESTAMP default from schema.sql.
  ensureColumn(db, "orders", "updated_at", "TEXT");
  // order_events.seq was added after the table shipped; back-fill for dev DBs.
  ensureColumn(db, "order_events", "seq", "INTEGER");
  // order_events.note (dispute reason / resolution note) likewise back-filled.
  ensureColumn(db, "order_events", "note", "TEXT");
  // Vendor payout receiver + the payout batch id recorded on PAYOUT.
  ensureColumn(db, "vendors", "payout_email", "TEXT");
  ensureColumn(db, "orders", "payout_batch_id", "TEXT");
}

/** Add `table.column` if it is missing (idempotent schema back-fill). */
function ensureColumn(
  db: DatabaseSync,
  table: string,
  column: string,
  decl: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
  }[];
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }
}

/**
 * Open (and migrate) a SQLite database. `url` is a DATABASE_URL-style value;
 * when omitted it falls back to process.env.DATABASE_URL and then the dev file.
 * Pass ":memory:" for an isolated in-memory DB (used by tests).
 */
export function openDb(url?: string): DatabaseSync {
  const db = new DatabaseSync(resolveDbPath(url), {
    enableForeignKeyConstraints: true,
  });
  migrate(db);
  return db;
}

/** Insert a new order and return the stored row. */
export function createOrder(db: DatabaseSync, input: NewOrder): OrderRow {
  const id = input.id ?? `ord_${randomUUID()}`;
  const status: EscrowState = input.status ?? "MATCHED";
  db.prepare(
    `INSERT INTO orders
       (id, dataset_id, buyer_email, paypal_order_id, authorization_id, status, amount_cents, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
  ).run(
    id,
    input.datasetId,
    input.buyerEmail,
    input.paypalOrderId ?? null,
    input.authorizationId ?? null,
    status,
    input.amountCents,
  );
  // Genesis audit row: from_state null, event CREATE, to_state the initial state.
  insertOrderEvent(db, id, "CREATE", null, status);
  return requireOrder(db, id);
}

/** Read one order by id, or undefined if it does not exist. */
export function getOrder(db: DatabaseSync, id: string): OrderRow | undefined {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as
    OrderRow | undefined;
}

/** Optional filters for `listOrders` (all AND-combined). */
export interface OrderFilter {
  status?: EscrowState;
  datasetId?: string;
  buyerEmail?: string;
}

/**
 * List orders, newest first, optionally filtered. Backs the read endpoint the
 * UI polls (vendor incoming-orders view, dispute queue).
 */
export function listOrders(
  db: DatabaseSync,
  filter: OrderFilter = {},
): OrderRow[] {
  const where: string[] = [];
  const values: string[] = [];
  if (filter.status) {
    where.push("status = ?");
    values.push(filter.status);
  }
  if (filter.datasetId) {
    where.push("dataset_id = ?");
    values.push(filter.datasetId);
  }
  if (filter.buyerEmail) {
    where.push("buyer_email = ?");
    values.push(filter.buyerEmail);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  return db
    .prepare(`SELECT * FROM orders ${clause} ORDER BY created_at DESC, id DESC`)
    .all(...values) as OrderRow[];
}

/**
 * Vendor earnings roll-up across orders. Every EscrowState is present in
 * `countsByStatus` (zero-filled) so the UI never has to guess at missing keys.
 */
export interface OrderSummary {
  countsByStatus: Record<EscrowState, number>;
  /** Funds authorized but not yet captured: AUTHORIZED + DELIVERED + DISPUTED. */
  heldCents: number;
  /** Funds captured from the buyer: CAPTURED + PAID_OUT. */
  capturedCents: number;
  /** Captured funds already paid out to the vendor: PAID_OUT. */
  paidOutCents: number;
  /** Authorizations released back to the buyer: VOIDED. */
  releasedCents: number;
}

const HELD_STATES: readonly EscrowState[] = [
  "AUTHORIZED",
  "DELIVERED",
  "DISPUTED",
];
const CAPTURED_STATES: readonly EscrowState[] = ["CAPTURED", "PAID_OUT"];

/**
 * Aggregate order counts and amounts by escrow state in one GROUP BY, then
 * fold them into the earnings buckets. Optionally scoped to one dataset.
 */
export function summarizeOrders(
  db: DatabaseSync,
  filter: { datasetId?: string } = {},
): OrderSummary {
  const clause = filter.datasetId ? "WHERE dataset_id = ?" : "";
  const values = filter.datasetId ? [filter.datasetId] : [];
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n, COALESCE(SUM(amount_cents), 0) AS cents
       FROM orders ${clause} GROUP BY status`,
    )
    .all(...values) as { status: EscrowState; n: number; cents: number }[];

  const countsByStatus = Object.fromEntries(
    ESCROW_STATES.map((s) => [s, 0]),
  ) as Record<EscrowState, number>;
  const cents = { ...countsByStatus };
  for (const r of rows) {
    countsByStatus[r.status] = r.n;
    cents[r.status] = r.cents;
  }
  const sum = (states: readonly EscrowState[]) =>
    states.reduce((t, s) => t + cents[s], 0);
  return {
    countsByStatus,
    heldCents: sum(HELD_STATES),
    capturedCents: sum(CAPTURED_STATES),
    paidOutCents: cents.PAID_OUT,
    releasedCents: cents.VOIDED,
  };
}

/** A persisted dataset row (snake_case columns, as stored). */
export interface DatasetRow {
  id: string;
  vendor_id: string;
  title: string;
  description: string | null;
  price_cents: number;
  created_at: string;
}

/**
 * Read one dataset by id, or undefined if it does not exist. Routes use this to
 * turn a bad `datasetId` into a clean 422 instead of a foreign-key level throw
 * when `createOrder` runs.
 */
export function getDataset(
  db: DatabaseSync,
  id: string,
): DatasetRow | undefined {
  return db.prepare(`SELECT * FROM datasets WHERE id = ?`).get(id) as
    DatasetRow | undefined;
}

/** Optional columns an `advanceOrder` call may patch alongside the state. */
export interface OrderPatch {
  paypalOrderId?: string | null;
  authorizationId?: string | null;
  payoutBatchId?: string | null;
}

/**
 * Find the order a PayPal object refers to. Each id is matched against every
 * PayPal reference we store (order id, authorization id, payout batch id), so
 * a webhook can pass whatever ids its resource carries. Empty/undefined ids
 * are skipped; returns undefined when nothing matches.
 */
export function findOrderByPayPalRef(
  db: DatabaseSync,
  ids: ReadonlyArray<string | null | undefined>,
): OrderRow | undefined {
  const refs = [...new Set(ids.filter((i): i is string => !!i))];
  if (refs.length === 0) return undefined;
  const marks = refs.map(() => "?").join(", ");
  return db
    .prepare(
      `SELECT * FROM orders
       WHERE authorization_id IN (${marks})
          OR paypal_order_id IN (${marks})
          OR payout_batch_id IN (${marks})
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(...refs, ...refs, ...refs) as OrderRow | undefined;
}

/** A processed PayPal webhook delivery (dedupe ledger row). */
export interface WebhookEventRecord {
  id: string;
  eventType: string;
  resourceId?: string | null;
  orderId?: string | null;
}

/**
 * Record a PayPal webhook event as processed. Returns false — and writes
 * nothing — when the event id was already recorded (a replay).
 */
export function recordWebhookEvent(
  db: DatabaseSync,
  rec: WebhookEventRecord,
): boolean {
  const { changes } = db
    .prepare(
      `INSERT INTO paypal_webhook_events (id, event_type, resource_id, order_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(rec.id, rec.eventType, rec.resourceId ?? null, rec.orderId ?? null);
  return Number(changes) > 0;
}

/** A persisted vendor row (snake_case columns, as stored). */
export interface VendorRow {
  id: string;
  name: string;
  /** PayPal email the vendor is paid at; null until onboarded for payouts. */
  payout_email: string | null;
  created_at: string;
}

/** Read one vendor by id, or undefined if it does not exist. */
export function getVendor(db: DatabaseSync, id: string): VendorRow | undefined {
  return db.prepare(`SELECT * FROM vendors WHERE id = ?`).get(id) as
    VendorRow | undefined;
}

/**
 * Advance an order by applying a state-machine event and persisting the
 * resulting state. Throws InvalidTransitionError (from `transition`) on an
 * illegal move — because that throws before the UPDATE, the stored state is
 * left untouched. Throws if the order does not exist.
 */
export function advanceOrder(
  db: DatabaseSync,
  id: string,
  event: EscrowEvent,
  patch?: OrderPatch,
  note?: string,
): OrderRow {
  const current = requireOrder(db, id);
  const next = transition(current.status, event); // throws => no write below

  // One UPDATE: the new state plus any PayPal ids the transition produced
  // (authorization id on AUTHORIZE, etc.), so state and ids never drift apart.
  // updated_at tracks last activity for the UI.
  const sets = ["status = ?", "updated_at = CURRENT_TIMESTAMP"];
  const values: (string | null)[] = [next];
  if (patch && "paypalOrderId" in patch) {
    sets.push("paypal_order_id = ?");
    values.push(patch.paypalOrderId ?? null);
  }
  if (patch && "authorizationId" in patch) {
    sets.push("authorization_id = ?");
    values.push(patch.authorizationId ?? null);
  }
  if (patch && "payoutBatchId" in patch) {
    sets.push("payout_batch_id = ?");
    values.push(patch.payoutBatchId ?? null);
  }
  values.push(id);
  db.prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).run(
    ...values,
  );
  // Audit the transition after the state write so history mirrors the status.
  insertOrderEvent(db, id, event, current.status, next, note);
  return requireOrder(db, id);
}

/**
 * Convenience for routes: open the default DB (honoring DATABASE_URL), run
 * `fn`, and always close. `url` lets callers/tests point at an isolated DB.
 */
export function withDb<T>(fn: (db: DatabaseSync) => T, url?: string): T {
  const db = openDb(url);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/**
 * Append an immutable audit row for an order transition. Called inside
 * createOrder (genesis) and advanceOrder (every transition) so the history can
 * never drift from the order's current status.
 */
function insertOrderEvent(
  db: DatabaseSync,
  orderId: string,
  event: string,
  from: EscrowState | null,
  to: EscrowState,
  note?: string,
): void {
  // seq is the count of prior events for this order (0 = genesis). Per-order
  // transitions are serialized by the request flow, so the count is stable.
  const { n } = db
    .prepare(`SELECT COUNT(*) AS n FROM order_events WHERE order_id = ?`)
    .get(orderId) as { n: number };
  db.prepare(
    `INSERT INTO order_events (id, order_id, seq, event, from_state, to_state, note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(`evt_${randomUUID()}`, orderId, n, event, from, to, note ?? null);
}

/** Read an order's event history, oldest first (by seq). */
export function listOrderEvents(
  db: DatabaseSync,
  orderId: string,
): OrderEventRow[] {
  return db
    .prepare(`SELECT * FROM order_events WHERE order_id = ? ORDER BY seq ASC`)
    .all(orderId) as OrderEventRow[];
}

function requireOrder(db: DatabaseSync, id: string): OrderRow {
  const row = getOrder(db, id);
  if (!row) throw new Error(`Order not found: ${id}`);
  return row;
}
