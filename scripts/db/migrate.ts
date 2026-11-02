import { migrateAppDatabase } from "../../lib/db/migrations";
import { closeAppDatabase } from "../../lib/db/connection";
async function main() {
  try {
    await migrateAppDatabase();
    console.log("App database schema is ready.");
  } catch {
    console.error(
      "Database migration failed. Check APP_DATABASE_URL, TLS settings, and database permissions.",
    );
    process.exitCode = 1;
  } finally {
    await closeAppDatabase();
  }
}
void main();
