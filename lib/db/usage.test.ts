// Usage persistence spec. In-memory SQLite per test; verifies the FK guard
// surfaces as UnknownOrderError and that listing is scoped + newest first.
import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb, createOrder } from "./client";
import {
  recordUsage,
  getUsage,
  listUsage,
  UnknownOrderError,
  PER_QUERY_FEE_CENTS,
} from "./usage";
import { PER_QUERY_FEE_CENTS as PRICING_FEE } from "../query/pricing";

function freshDb() {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "vnd_demo_health",
    "Demo Health",
  );
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_x", "vnd_demo_health", "Test Dataset", 100);
  const order = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "buyer@example.com",
    amountCents: 100,
  });
  return { db, orderId: order.id };
}

test("recordUsage persists a row with a generated qu_ id", () => {
  const { db, orderId } = freshDb();
  const row = recordUsage(db, {
    orderId,
    question: "How many patients by sex?",
    chargeCents: PER_QUERY_FEE_CENTS,
  });

  assert.match(row.id, /^qu_/);
  assert.equal(row.order_id, orderId);
  assert.equal(row.question, "How many patients by sex?");
  assert.equal(row.charge_cents, PER_QUERY_FEE_CENTS);
  assert.ok(row.created_at);
  assert.deepEqual(getUsage(db, row.id), row);
  db.close();
});

test("recordUsage honours a caller-supplied id", () => {
  const { db, orderId } = freshDb();
  const row = recordUsage(db, {
    id: "qu_fixed",
    orderId,
    question: "q",
    chargeCents: 0,
  });
  assert.equal(row.id, "qu_fixed");
  db.close();
});

test("recordUsage on an unknown order throws UnknownOrderError and writes nothing", () => {
  const { db } = freshDb();
  assert.throws(
    () =>
      recordUsage(db, {
        orderId: "ord_missing",
        question: "q",
        chargeCents: 50,
      }),
    (err: unknown) =>
      err instanceof UnknownOrderError && err.orderId === "ord_missing",
  );
  const count = db.prepare(`SELECT COUNT(*) AS n FROM query_usage`).get() as {
    n: number;
  };
  assert.equal(count.n, 0);
  db.close();
});

test("getUsage returns undefined for a missing id", () => {
  const { db } = freshDb();
  assert.equal(getUsage(db, "qu_nope"), undefined);
  db.close();
});

test("listUsage is scoped to the order and newest first", () => {
  const { db, orderId } = freshDb();
  const other = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "other@example.com",
    amountCents: 100,
  });
  // Same-second inserts tie on created_at; ids break the tie (DESC).
  recordUsage(db, { id: "qu_a", orderId, question: "first", chargeCents: 50 });
  recordUsage(db, { id: "qu_b", orderId, question: "second", chargeCents: 50 });
  recordUsage(db, {
    id: "qu_c",
    orderId: other.id,
    question: "elsewhere",
    chargeCents: 50,
  });

  assert.deepEqual(
    listUsage(db, orderId).map((r) => r.id),
    ["qu_b", "qu_a"],
  );
  assert.deepEqual(listUsage(db, "ord_missing"), []);
  db.close();
});

test("the re-exported fee is the pricing constant", () => {
  assert.equal(PER_QUERY_FEE_CENTS, PRICING_FEE);
});
