// Per-mandate spend ledger, stored in the database so it survives a restart and
// is shared by the web app and the MCP server (separate processes).
//
// Spend is reserved BEFORE PayPal is called, in one transaction with the limit
// check, so two concurrent runs cannot both pass a check that only one of them
// fits. A reservation with no order yet counts as spent. It then either gets
// linked to the order it opened or is released when nothing was opened.
//
// Spent = open reservations + orders still holding money. A VOIDED or CANCELLED
// order gives its budget back, and a linked order counts for its settled amount.
import { randomUUID } from "node:crypto";

import { transaction, type AppDatabase } from "../db/connection";
import { withDb } from "../db/store";
import { checkSpend, type Mandate, type MandateDataset } from "./mandate";

export async function spentOn(
  db: AppDatabase,
  mandateId: string,
): Promise<number> {
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(COALESCE(o.amount_cents, s.cents)), 0) AS total
         FROM mandate_spend s
         LEFT JOIN orders o ON o.id = s.order_id
        WHERE s.mandate_id = ?
          AND (o.status IS NULL OR o.status NOT IN ('VOIDED', 'CANCELLED'))`,
    )
    .get(mandateId)) as { total: string | number };
  return Number(row.total);
}

/** Whether the buyer has switched this mandate off. */
export async function isRevokedOn(
  db: AppDatabase,
  mandateId: string,
): Promise<boolean> {
  const row = (await db
    .prepare("SELECT revoked_at FROM mandates WHERE id = ?")
    .get(mandateId)) as { revoked_at: string | null } | undefined;
  return !!row?.revoked_at;
}

/** What a mandate has committed so far, in cents. */
export async function spentUnderMandate(mandateId: string): Promise<number> {
  return await withDb(async (db) => await spentOn(db, mandateId));
}

export type Reservation =
  { ok: true; reservationId: string } | { ok: false; reason: string };

/** Check the mandate's limits and hold the budget for one order, atomically. */
export async function reserveMandateSpend(
  mandate: Mandate,
  priceCents: number,
  dataset: MandateDataset,
): Promise<Reservation> {
  return await withDb(
    async (db) => await reserveOn(db, mandate, priceCents, dataset),
  );
}

/** reserveMandateSpend on a connection the caller already holds. */
export async function reserveOn(
  db: AppDatabase,
  mandate: Mandate,
  priceCents: number,
  dataset: MandateDataset,
): Promise<Reservation> {
  return await transaction(db, async (): Promise<Reservation> => {
    // SQLite's BEGIN IMMEDIATE already serializes writers.
    if (db.dialect === "postgres")
      await db
        .prepare("SELECT pg_advisory_xact_lock(hashtext(?))")
        .get(mandate.id);
    if (await isRevokedOn(db, mandate.id))
      return { ok: false, reason: "mandate revoked" };
    const decision = checkSpend(
      mandate,
      await spentOn(db, mandate.id),
      priceCents,
      dataset,
    );
    if (!decision.allow) return { ok: false, reason: decision.reason };
    const reservationId = `msp_${randomUUID()}`;
    await db
      .prepare(
        "INSERT INTO mandate_spend (id, mandate_id, cents) VALUES (?, ?, ?)",
      )
      .run(reservationId, mandate.id, priceCents);
    return { ok: true, reservationId };
  });
}

/** Tie a reservation to the order it paid for. */
export async function linkMandateSpend(
  reservationId: string,
  orderId: string,
): Promise<void> {
  await withDb(
    async (db) =>
      await db
        .prepare("UPDATE mandate_spend SET order_id = ? WHERE id = ?")
        .run(orderId, reservationId),
  );
}

/** Give a reservation back: the order failed, or an open one was reused. */
export async function releaseMandateSpend(
  reservationId: string,
): Promise<void> {
  await withDb(
    async (db) =>
      await db
        .prepare("DELETE FROM mandate_spend WHERE id = ?")
        .run(reservationId),
  );
}
