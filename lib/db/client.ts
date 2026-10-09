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
  status: EscrowState;
  amount_cents: number;
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
       (id, dataset_id, buyer_email, paypal_order_id, authorization_id, status, amount_cents)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.datasetId,
    input.buyerEmail,
    input.paypalOrderId ?? null,
    input.authorizationId ?? null,
    status,
    input.amountCents,
  );
  return requireOrder(db, id);
}

/** Read one order by id, or undefined if it does not exist. */
export function getOrder(db: DatabaseSync, id: string): OrderRow | undefined {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as
    OrderRow | undefined;
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
): OrderRow {
  const current = requireOrder(db, id);
  const next = transition(current.status, event); // throws => no write below
  db.prepare(`UPDATE orders SET status = ? WHERE id = ?`).run(next, id);
  return requireOrder(db, id);
}

function requireOrder(db: DatabaseSync, id: string): OrderRow {
  const row = getOrder(db, id);
  if (!row) throw new Error(`Order not found: ${id}`);
  return row;
}
