// Explicit one-time, insert-only import. Never runs during deployment startup.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  withDb,
  transaction,
  isPostgres,
  closeAppDatabase,
  type Value,
} from "../../lib/db/connection";
import { migrateAppDatabase } from "../../lib/db/migrations";
const tables = [
  "vendors",
  "accounts",
  "provider_connections",
  "datasets",
  "orders",
  "order_events",
  "query_usage",
  "mandate_spend",
  "paypal_webhook_events",
  "agent_runs",
  "account_agent_runs",
  "sessions",
];
async function main() {
  const path = process.env.SQLITE_IMPORT_PATH ?? "./data/dev.sqlite";
  if (!isPostgres() || !existsSync(path))
    throw new Error(
      "Set APP_DATABASE_URL to PostgreSQL and SQLITE_IMPORT_PATH to the existing SQLite file",
    );
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    await migrateAppDatabase();
    await withDb((db) =>
      transaction(db, async () => {
        for (const table of tables) {
          if (
            !source
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
              )
              .get(table)
          )
            continue;
          const destination = (await db
            .prepare(
              "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?",
            )
            .all(table)) as { column_name: string }[];
          const allowed = new Set(destination.map((c) => c.column_name));
          const columns = (
            source.prepare(`PRAGMA table_info(${table})`).all() as {
              name: string;
            }[]
          )
            .map((c) => c.name)
            .filter((c) => allowed.has(c));
          const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) ON CONFLICT DO NOTHING`;
          const rows = source.prepare(`SELECT * FROM ${table}`).all() as Record<
            string,
            Value
          >[];
          for (const row of rows)
            await db.prepare(sql).run(...columns.map((c) => row[c] ?? null));
          console.log(`Processed ${rows.length} ${table} row(s).`);
        }
      }),
    );
    console.log(
      "SQLite import completed. Existing destination rows were preserved; keep the source backup until verified.",
    );
  } finally {
    source.close();
  }
}
main()
  .catch(() => {
    console.error(
      "SQLite import failed and was rolled back. Check database access, schema compatibility, and account ID conflicts.",
    );
    process.exitCode = 1;
  })
  .finally(closeAppDatabase);
