import { withDb, closeAppDatabase } from "../../lib/db/connection";
async function main() {
  try {
    const dialect = await withDb(async (db) => {
      await db.prepare("SELECT 1 AS ok").get();
      for (const table of [
        "accounts",
        "sessions",
        "orders",
        "datasets",
        "provider_connections",
      ])
        await db.exec(`SELECT 1 FROM ${table} LIMIT 0`);
      return db.dialect;
    });
    console.log(`App database is reachable and migrated (${dialect}).`);
  } catch {
    console.error(
      "App database check failed. Verify configuration and run npm run db:migrate.",
    );
    process.exitCode = 1;
  } finally {
    await closeAppDatabase();
  }
}
void main();
