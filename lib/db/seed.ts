// Database seed.
// Applies lib/db/schema.sql and loads data/catalog.json (vendors + datasets)
// into the local SQLite database. Run with `npm run seed`.
//
// Idempotent: tables are created IF NOT EXISTS and rows are upserted
// (ON CONFLICT ... DO UPDATE), so re-running is safe and refreshes the catalog.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DatabaseSync } from "node:sqlite";

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

/** Sandbox PayPal receiver for seeded vendors' payouts (demo only). */
const DEMO_VENDOR_PAYOUT_EMAIL = "vendor-demo@meddata.test";

/** Derive a display name from a vendor id, e.g. vnd_demo_health -> "Demo Health". */
function vendorName(vendorId: string): string {
  return vendorId
    .replace(/^vnd_/, "")
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Load the catalog (vendors + datasets) into an open, migrated database.
 * Idempotent upserts; returns how many rows of each were written. Exported so
 * scripts (e.g. the `npm run demo` happy path) can seed a scratch database.
 */
export function seedDatabase(db: DatabaseSync): {
  vendors: number;
  datasets: number;
} {
  const catalog = JSON.parse(
    readFileSync(CATALOG_PATH, "utf8"),
  ) as CatalogEntry[];

  const vendorIds = [...new Set(catalog.map((d) => d.vendorId))];
  // Every demo vendor is paid at one sandbox payout address; COALESCE keeps a
  // payout email someone already set by hand.
  const upsertVendor = db.prepare(
    `INSERT INTO vendors (id, name, payout_email) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name         = excluded.name,
         payout_email = COALESCE(vendors.payout_email, excluded.payout_email)`,
  );
  for (const vendorId of vendorIds) {
    upsertVendor.run(vendorId, vendorName(vendorId), DEMO_VENDOR_PAYOUT_EMAIL);
  }
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
  return { vendors: vendorIds.length, datasets: catalog.length };
}

function main(): void {
  console.log(`[seed] meddata-escrow -> ${resolveDbPath()}`);
  const db = openDb();
  console.log("[seed] applied schema.sql");
  const { vendors, datasets } = seedDatabase(db);
  console.log(`[seed] upserted ${vendors} vendor(s)`);
  console.log(`[seed] upserted ${datasets} dataset(s)`);
  db.close();
  console.log("[seed] done.");
}

// Run only when executed directly (`npm run seed`), not when imported.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
