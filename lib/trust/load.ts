// DB-backed trust lookups: load orders, audit events and sample-check results
// for a dataset or vendor, then hand them to the pure scorer.
//
// Sample checks use the deterministic rules verdict over the catalog's mock
// vendor sample (no LLM, no network), so a score is reproducible. Datasets
// missing from the catalog simply contribute no sample check.
import type { DatabaseSync } from "node:sqlite";

import { loadCatalog } from "../ai/matcher";
import { rulesVerdict, sampleProfile } from "../ai/sample-check";
import type { DatasetRow, OrderEventRow, OrderRow } from "../db/client";
import { trustScore, type TrustOrder, type TrustScore } from "./score";

export interface DatasetTrust {
  datasetId: string;
  vendorId: string;
  title: string;
  trust: TrustScore;
}

export interface VendorTrust {
  vendorId: string;
  name: string;
  trust: TrustScore;
}

function sampleChecksFor(datasetIds: string[]): boolean[] {
  const catalog = new Map(loadCatalog().map((d) => [d.id, d]));
  const out: boolean[] = [];
  for (const id of datasetIds) {
    const entry = catalog.get(id);
    if (entry) out.push(rulesVerdict(sampleProfile(entry)).passed);
  }
  return out;
}

function ordersFor(db: DatabaseSync, datasetIds: string[]): TrustOrder[] {
  if (datasetIds.length === 0) return [];
  const marks = datasetIds.map(() => "?").join(", ");
  const orders = db
    .prepare(`SELECT id FROM orders WHERE dataset_id IN (${marks})`)
    .all(...datasetIds) as Pick<OrderRow, "id">[];
  const events = db
    .prepare(
      `SELECT e.* FROM order_events e
       JOIN orders o ON o.id = e.order_id
       WHERE o.dataset_id IN (${marks})
       ORDER BY e.order_id, e.seq`,
    )
    .all(...datasetIds) as OrderEventRow[];
  const byOrder = new Map<string, OrderEventRow[]>();
  for (const e of events) {
    const list = byOrder.get(e.order_id) ?? [];
    list.push(e);
    byOrder.set(e.order_id, list);
  }
  return orders.map((o) => ({ id: o.id, events: byOrder.get(o.id) ?? [] }));
}

function score(db: DatabaseSync, datasetIds: string[]): TrustScore {
  return trustScore({
    orders: ordersFor(db, datasetIds),
    sampleChecks: sampleChecksFor(datasetIds),
  });
}

/** Trust for one dataset, or null if it does not exist. */
export function datasetTrust(
  db: DatabaseSync,
  datasetId: string,
): DatasetTrust | null {
  const ds = db
    .prepare(`SELECT * FROM datasets WHERE id = ?`)
    .get(datasetId) as DatasetRow | undefined;
  if (!ds) return null;
  return {
    datasetId: ds.id,
    vendorId: ds.vendor_id,
    title: ds.title,
    trust: score(db, [ds.id]),
  };
}

/** Trust for a vendor across all its datasets, or null if unknown. */
export function vendorTrust(
  db: DatabaseSync,
  vendorId: string,
): VendorTrust | null {
  const v = db.prepare(`SELECT * FROM vendors WHERE id = ?`).get(vendorId) as
    { id: string; name: string } | undefined;
  if (!v) return null;
  const ids = (
    db.prepare(`SELECT id FROM datasets WHERE vendor_id = ?`).all(vendorId) as {
      id: string;
    }[]
  ).map((d) => d.id);
  return { vendorId: v.id, name: v.name, trust: score(db, ids) };
}

/** Every vendor and dataset with its trust score. */
export function listTrust(db: DatabaseSync): {
  vendors: VendorTrust[];
  datasets: DatasetTrust[];
} {
  const vendors = (
    db.prepare(`SELECT id FROM vendors ORDER BY id`).all() as { id: string }[]
  ).map((v) => vendorTrust(db, v.id)!);
  const datasets = (
    db.prepare(`SELECT id FROM datasets ORDER BY id`).all() as { id: string }[]
  ).map((d) => datasetTrust(db, d.id)!);
  return { vendors, datasets };
}
