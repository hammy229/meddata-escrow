// Stored mandates: what a buyer has issued, so a UI can list them and the buyer
// can revoke one. Authority stays with the signed token (./mandate); a row adds
// the one thing a stateless token cannot do, which is stop working early.
import { withDb } from "../db/store";
import type { Mandate } from "./mandate";
import { isRevokedOn, spentOn } from "./mandate-ledger";
import type { AppDatabase } from "../db/connection";

export type MandateStatus = "active" | "expired" | "revoked";

export interface MandateSummary {
  id: string;
  buyerId: string;
  maxTotalCents: number;
  maxPerOrderCents: number;
  allowedVendors?: string[];
  allowedTags?: string[];
  spentCents: number;
  remainingCents: number;
  status: MandateStatus;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
}

interface MandateRow {
  id: string;
  buyer_id: string;
  max_total_cents: number;
  max_per_order_cents: number;
  allowed_vendors_json: string | null;
  allowed_tags_json: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

async function summarize(
  db: AppDatabase,
  row: MandateRow,
  now: Date,
): Promise<MandateSummary> {
  const spentCents = await spentOn(db, row.id);
  const maxTotalCents = Number(row.max_total_cents);
  return {
    id: row.id,
    buyerId: row.buyer_id,
    maxTotalCents,
    maxPerOrderCents: Number(row.max_per_order_cents),
    ...(row.allowed_vendors_json
      ? { allowedVendors: JSON.parse(row.allowed_vendors_json) as string[] }
      : {}),
    ...(row.allowed_tags_json
      ? { allowedTags: JSON.parse(row.allowed_tags_json) as string[] }
      : {}),
    spentCents,
    remainingCents: Math.max(maxTotalCents - spentCents, 0),
    status: row.revoked_at
      ? "revoked"
      : Date.parse(row.expires_at) < now.getTime()
        ? "expired"
        : "active",
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
  };
}

/** Record a freshly issued mandate. */
export async function saveMandate(mandate: Mandate): Promise<void> {
  await withDb(
    async (db) =>
      await db
        .prepare(
          `INSERT INTO mandates (id, buyer_id, max_total_cents, max_per_order_cents,
             allowed_vendors_json, allowed_tags_json, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          mandate.id,
          mandate.buyerId,
          mandate.maxTotalCents,
          mandate.maxPerOrderCents,
          mandate.allowedVendors
            ? JSON.stringify(mandate.allowedVendors)
            : null,
          mandate.allowedTags ? JSON.stringify(mandate.allowedTags) : null,
          mandate.expiresAt,
        ),
  );
}

/** A buyer's mandates, newest first. */
export async function listMandates(
  buyerId: string,
  now: Date = new Date(),
): Promise<MandateSummary[]> {
  return await withDb(async (db) => {
    const rows = (await db
      .prepare(
        "SELECT * FROM mandates WHERE buyer_id = ? ORDER BY created_at DESC, id DESC",
      )
      .all(buyerId)) as MandateRow[];
    return await Promise.all(rows.map((r) => summarize(db, r, now)));
  });
}

/** Revoke a buyer's mandate. Undefined if it is not theirs. Safe to repeat. */
export async function revokeMandate(
  mandateId: string,
  buyerId: string,
  now: Date = new Date(),
): Promise<MandateSummary | undefined> {
  return await withDb(async (db) => {
    await db
      .prepare(
        "UPDATE mandates SET revoked_at = ? WHERE id = ? AND buyer_id = ? AND revoked_at IS NULL",
      )
      .run(now.toISOString(), mandateId, buyerId);
    const row = (await db
      .prepare("SELECT * FROM mandates WHERE id = ? AND buyer_id = ?")
      .get(mandateId, buyerId)) as MandateRow | undefined;
    return row && (await summarize(db, row, now));
  });
}

/** Whether a mandate has been revoked. A token with no row never was. */
export async function isMandateRevoked(mandateId: string): Promise<boolean> {
  return await withDb(async (db) => await isRevokedOn(db, mandateId));
}
