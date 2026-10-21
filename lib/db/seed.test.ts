// Seed spec — an in-memory DB, so no files are touched.
import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb } from "./client";
import { seedDatabase } from "./seed";

test("seedDatabase loads the catalog and is idempotent", () => {
  const db = openDb(":memory:");
  const first = seedDatabase(db);
  const second = seedDatabase(db);
  assert.deepEqual(first, second);

  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  assert.equal(count("vendors"), first.vendors);
  assert.equal(count("datasets"), first.datasets);
  db.close();
});

test("re-seeding keeps a payout email set by hand", () => {
  const db = openDb(":memory:");
  seedDatabase(db);
  db.prepare(`UPDATE vendors SET payout_email = ?`).run("me@vendor.test");
  seedDatabase(db);
  const rows = db.prepare(`SELECT payout_email FROM vendors`).all() as {
    payout_email: string;
  }[];
  assert.ok(rows.every((r) => r.payout_email === "me@vendor.test"));
  db.close();
});
