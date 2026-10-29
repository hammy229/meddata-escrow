// Demo reset: wipe all transactional data and put the catalog back, so a mock-
// mode demo can start from a clean slate. Backs POST /api/demo/reset, which
// only runs in PAYPAL_MODE=mock.
//
// Child tables go before `orders` (foreign keys). `agent_runs` is created
// lazily by lib/agent/store, so it is cleared only if it exists. Vendors and
// datasets are not deleted; seedDatabase() re-upserts them (restoring titles
// and prices) and keeps any payout email set by hand.
import type { DatabaseSync } from "node:sqlite";

import { seedDatabase } from "./seed";

const CLEARED_TABLES = [
  "paypal_webhook_events",
  "order_events",
  "query_usage",
  "orders",
  "agent_runs",
] as const;

/** Clear orders, events, usage, agent runs and webhook dedupe rows, then
 *  reseed the catalog. All-or-nothing. */
export function resetDemoData(db: DatabaseSync): {
  vendors: number;
  datasets: number;
} {
  db.exec("BEGIN");
  try {
    for (const table of CLEARED_TABLES) {
      const exists = db
        .prepare(
          `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
        )
        .get(table);
      if (exists) db.exec(`DELETE FROM ${table}`);
    }
    const seeded = seedDatabase(db);
    db.exec("COMMIT");
    return seeded;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
