import { readFileSync } from "node:fs";
import { withDb, transaction, type AppDatabase } from "./connection";
export async function migratePostgres(db: AppDatabase): Promise<void> {
  await transaction(db, async () => {
    await db.exec("SELECT pg_advisory_xact_lock(1735142642)");
    await db.exec(
      readFileSync(new URL("./schema.postgres.sql", import.meta.url), "utf8"),
    );
    await db
      .prepare(
        "INSERT INTO app_migrations (version) VALUES (?) ON CONFLICT(version) DO NOTHING",
      )
      .run(1);
    const required = [
      "accounts",
      "sessions",
      "orders",
      "datasets",
      "provider_connections",
    ];
    for (const table of required)
      await db.exec(`SELECT 1 FROM ${table} LIMIT 0`);
  });
}
export async function migrateAppDatabase(): Promise<void> {
  await withDb(async (db) => {
    if (db.dialect === "postgres") await migratePostgres(db);
  });
}
