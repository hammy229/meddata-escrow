// Database seed.
// Applies lib/db/schema.sql and loads data/catalog.json (vendors + datasets)
// into the local SQLite database. Run with `npm run seed`.
//
// Idempotent: tables are created IF NOT EXISTS and rows are upserted
// (ON CONFLICT ... DO UPDATE), so re-running is safe and refreshes the catalog.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, resolveDbPath } from "./client";

interface CatalogEntry {
  id: string;
  vendorId: string;
  title: string;
  description?: string;
  priceCents: number;
}

const CATALOG_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "catalog.json",
);

/** Derive a display name from a vendor id, e.g. vnd_demo_health -> "Demo Health". */
function vendorName(vendorId: string): string {
  return vendorId
    .replace(/^vnd_/, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function main(): Promise<void> {
  const target = resolveDbPath();
  console.log(`[seed] meddata-escrow -> ${target}`);

  const db = openDb();
  console.log("[seed] applied schema.sql");

  const catalog = JSON.parse(
    readFileSync(CATALOG_PATH, "utf8"),
  ) as CatalogEntry[];

  const vendorIds = [...new Set(catalog.map((d) => d.vendorId))];
  const upsertVendor = db.prepare(
    `INSERT INTO vendors (id, name) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
  );
  for (const vendorId of vendorIds) {
    upsertVendor.run(vendorId, vendorName(vendorId));
  }
  console.log(`[seed] upserted ${vendorIds.length} vendor(s)`);

  const upsertDataset = db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, description, price_cents)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         vendor_id   = excluded.vendor_id,
         title       = excluded.title,
         description = excluded.description,
         price_cents = excluded.price_cents`,
  );
  for (const d of catalog) {
    upsertDataset.run(
      d.id,
      d.vendorId,
      d.title,
      d.description ?? null,
      d.priceCents,
    );
  }
  console.log(`[seed] upserted ${catalog.length} dataset(s)`);

  db.close();
  console.log("[seed] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
