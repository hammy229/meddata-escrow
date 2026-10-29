// Demo reset spec — in-memory DB, no files touched.
import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb, createOrder, advanceOrder } from "./client";
import { recordUsage } from "./usage";
import { seedDatabase } from "./seed";
import { resetDemoData } from "./reset";

const count = (db: ReturnType<typeof openDb>, table: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function dirtyDb() {
  const db = openDb(":memory:");
  seedDatabase(db);
  const dataset = db.prepare(`SELECT id FROM datasets LIMIT 1`).get() as {
    id: string;
  };
  const order = createOrder(db, {
    datasetId: dataset.id,
    buyerEmail: "b@example.com",
    amountCents: 4900,
    paypalOrderId: "PP-1",
  });
  advanceOrder(db, order.id, "AUTHORIZE", { authorizationId: "A-1" });
  recordUsage(db, { orderId: order.id, question: "q", chargeCents: 50 });
  db.prepare(
    `INSERT INTO paypal_webhook_events (id, event_type, order_id) VALUES (?, ?, ?)`,
  ).run("WH-1", "PAYMENT.CAPTURE.COMPLETED", order.id);
  return db;
}

test("reset clears orders, events, usage and webhook rows, keeps the catalog", () => {
  const db = dirtyDb();
  const catalog = {
    vendors: count(db, "vendors"),
    datasets: count(db, "datasets"),
  };
  assert.ok(count(db, "orders") > 0 && count(db, "order_events") > 0);

  const seeded = resetDemoData(db);

  for (const t of [
    "orders",
    "order_events",
    "query_usage",
    "paypal_webhook_events",
  ])
    assert.equal(count(db, t), 0, t);
  assert.deepEqual(seeded, catalog);
  assert.equal(count(db, "vendors"), catalog.vendors);
  assert.equal(count(db, "datasets"), catalog.datasets);
  db.close();
});

test("reset clears agent_runs when the table exists and tolerates it missing", () => {
  const db = dirtyDb();
  resetDemoData(db); // no agent_runs yet: must not throw
  db.exec(`CREATE TABLE agent_runs (id TEXT PRIMARY KEY, study TEXT)`);
  db.prepare(`INSERT INTO agent_runs (id, study) VALUES ('run_1', 's')`).run();
  resetDemoData(db);
  assert.equal(count(db, "agent_runs"), 0);
  db.close();
});

test("reset restores a dataset price someone changed", () => {
  const db = dirtyDb();
  const before = db
    .prepare(`SELECT id, price_cents FROM datasets LIMIT 1`)
    .get() as {
    id: string;
    price_cents: number;
  };
  db.prepare(`UPDATE datasets SET price_cents = 1 WHERE id = ?`).run(before.id);
  resetDemoData(db);
  const after = db
    .prepare(`SELECT price_cents FROM datasets WHERE id = ?`)
    .get(before.id) as { price_cents: number };
  assert.equal(after.price_cents, before.price_cents);
  db.close();
});

test("reset is repeatable", () => {
  const db = dirtyDb();
  resetDemoData(db);
  resetDemoData(db);
  assert.equal(count(db, "orders"), 0);
  db.close();
});
