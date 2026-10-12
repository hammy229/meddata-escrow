// Per-query usage persistence (the `query_usage` table from schema.sql).
//
// Billing records one row per successful /api/query call. This module only
// touches that table; it imports `openDb` (and `getOrder` for the FK guard)
// from the escrow DB client but does not modify it. SQL stays portable so the
// same code runs on Postgres in production.
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

import { getOrder, withDb } from "./client";

// Re-exported from the DB client (its natural home) so existing importers that
// reach for it here — e.g. app/api/billing/route.ts — keep working unchanged.
export { withDb };

/** A persisted usage row (snake_case columns, as stored). */
export interface UsageRow {
  id: string;
  order_id: string;
  question: string;
  charge_cents: number;
  created_at: string;
}

/** Fields accepted when recording a usage row. */
export interface NewUsage {
  orderId: string;
  question: string;
  chargeCents: number;
  /** Defaults to a generated `qu_<uuid>`. */
  id?: string;
}

/**
 * Thrown when a usage row references an order that does not exist. The caller
 * maps this to a clean 422 rather than letting the raw FK error become a 500.
 */
export class UnknownOrderError extends Error {
  constructor(public readonly orderId: string) {
    super(`Unknown orderId: ${orderId}`);
    this.name = "UnknownOrderError";
  }
}

/**
 * Insert a usage row and return it. Checks the order exists first so a missing
 * FK is reported as `UnknownOrderError` (-> 422) instead of a DB-level throw.
 */
export function recordUsage(db: DatabaseSync, input: NewUsage): UsageRow {
  if (!getOrder(db, input.orderId)) {
    throw new UnknownOrderError(input.orderId);
  }
  const id = input.id ?? `qu_${randomUUID()}`;
  db.prepare(
    `INSERT INTO query_usage (id, order_id, question, charge_cents)
     VALUES (?, ?, ?, ?)`,
  ).run(id, input.orderId, input.question, input.chargeCents);
  return requireUsage(db, id);
}

/** Read one usage row by id, or undefined if it does not exist. */
export function getUsage(db: DatabaseSync, id: string): UsageRow | undefined {
  return db.prepare(`SELECT * FROM query_usage WHERE id = ?`).get(id) as
    UsageRow | undefined;
}

/** List usage rows for an order, newest first. */
export function listUsage(db: DatabaseSync, orderId: string): UsageRow[] {
  return db
    .prepare(
      `SELECT * FROM query_usage WHERE order_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(orderId) as UsageRow[];
}

function requireUsage(db: DatabaseSync, id: string): UsageRow {
  const row = getUsage(db, id);
  if (!row) throw new Error(`Usage row not found: ${id}`);
  return row;
}
