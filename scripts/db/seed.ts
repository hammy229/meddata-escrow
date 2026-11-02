import { readFileSync } from "node:fs";
import { withDb, closeAppDatabase, transaction } from "../../lib/db/connection";
import { migrateAppDatabase } from "../../lib/db/migrations";
async function main() {
  try {
    await migrateAppDatabase();
    const catalog = JSON.parse(
      readFileSync(new URL("../../data/catalog.json", import.meta.url), "utf8"),
    ) as {
      id: string;
      vendorId: string;
      title: string;
      description: string;
      priceCents: number;
    }[];
    await withDb((db) =>
      transaction(db, async () => {
        for (const d of catalog) {
          await db
            .prepare(
              "INSERT INTO vendors (id, name, payout_email) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING",
            )
            .run(
              d.vendorId,
              d.vendorId.replace(/^vnd_/, "").replaceAll("_", " "),
              "vendor-demo@meddata.test",
            );
          await db
            .prepare(
              "INSERT INTO datasets (id, vendor_id, title, description, price_cents) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING",
            )
            .run(
              d.id,
              d.vendorId,
              d.title,
              d.description ?? null,
              d.priceCents,
            );
        }
      }),
    );
    console.log(
      "Synthetic catalog seeded. Existing accounts, orders, and prices were preserved.",
    );
  } catch {
    console.error(
      "Database seeding failed. Check the app database configuration.",
    );
    process.exitCode = 1;
  } finally {
    await closeAppDatabase();
  }
}
void main();
