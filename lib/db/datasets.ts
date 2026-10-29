// Dataset listings for the vendor catalog and the datasets API. The database
// holds the price escrow orders charge; tags and record counts are display
// metadata that only data/catalog.json carries, so they are merged in here.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

import { getDataset, type DatasetRow } from "./client";

/** A listing as returned by /api/datasets. */
export interface Dataset {
  id: string;
  vendorId: string;
  title: string;
  description: string | null;
  priceCents: number;
  recordCount: number | null;
  tags: string[];
}

interface CatalogMeta {
  id: string;
  recordCount?: number;
  tags?: string[];
}

const CATALOG_URL = new URL("../../data/catalog.json", import.meta.url);

function loadMeta(): Map<string, CatalogMeta> {
  const entries = JSON.parse(
    readFileSync(CATALOG_URL, "utf8"),
  ) as CatalogMeta[];
  return new Map(entries.map((e) => [e.id, e]));
}

function toDataset(row: DatasetRow, meta: Map<string, CatalogMeta>): Dataset {
  const m = meta.get(row.id);
  return {
    id: row.id,
    vendorId: row.vendor_id,
    title: row.title,
    description: row.description,
    priceCents: row.price_cents,
    recordCount: m?.recordCount ?? null,
    tags: m?.tags ?? [],
  };
}

/** Every listing, oldest first (the order the catalog was seeded in). */
export function listDatasets(db: DatabaseSync): Dataset[] {
  const meta = loadMeta();
  const rows = db
    .prepare(`SELECT * FROM datasets ORDER BY created_at ASC, rowid ASC`)
    .all() as DatasetRow[];
  return rows.map((r) => toDataset(r, meta));
}

/**
 * Set a listing's price and return it, or undefined if the dataset does not
 * exist. Callers validate the price first (lib/catalog/price-rules).
 */
export function updateDatasetPrice(
  db: DatabaseSync,
  id: string,
  priceCents: number,
): Dataset | undefined {
  if (!getDataset(db, id)) return undefined;
  db.prepare(`UPDATE datasets SET price_cents = ? WHERE id = ?`).run(
    priceCents,
    id,
  );
  return toDataset(getDataset(db, id)!, loadMeta());
}

/** Current prices by dataset id, for callers that only need the money. */
export function priceMap(db: DatabaseSync): Map<string, number> {
  const rows = db.prepare(`SELECT id, price_cents FROM datasets`).all() as {
    id: string;
    price_cents: number;
  }[];
  return new Map(rows.map((r) => [r.id, r.price_cents]));
}
