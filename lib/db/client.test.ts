// DB persistence spec. Uses an in-memory SQLite DB per test (never the dev
// file) and verifies the state machine stays the source of truth: legal
// advances persist, illegal advances throw AND leave stored state untouched.
import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb, createOrder, getOrder, advanceOrder } from "./client";
import { InvalidTransitionError } from "../escrow/state-machine";

// Fresh in-memory DB with the parent vendor/dataset rows that orders
// reference (foreign keys are enforced), so tests exercise realistic inserts.
function freshDb() {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "vnd_demo_health",
    "Demo Health",
  );
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_cardio_synthea_v1", "vnd_demo_health", "Cardio Cohort", 4900);
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_x", "vnd_demo_health", "Test Dataset", 100);
  return db;
}

test("create -> read round-trip", () => {
  const db = freshDb();
  const created = createOrder(db, {
    datasetId: "ds_cardio_synthea_v1",
    buyerEmail: "buyer@example.com",
    amountCents: 4900,
  });

  assert.match(created.id, /^ord_/);
  assert.equal(created.status, "MATCHED"); // default initial state
  assert.equal(created.amount_cents, 4900);

  const read = getOrder(db, created.id);
  assert.deepEqual(read, created);
  db.close();
});

test("createOrder honors an explicit id and status", () => {
  const db = freshDb();
  const created = createOrder(db, {
    id: "ord_fixed",
    datasetId: "ds_x",
    buyerEmail: "b@example.com",
    amountCents: 100,
    status: "AUTHORIZED",
  });
  assert.equal(created.id, "ord_fixed");
  assert.equal(created.status, "AUTHORIZED");
  db.close();
});

test("getOrder returns undefined for an unknown id", () => {
  const db = freshDb();
  assert.equal(getOrder(db, "ord_missing"), undefined);
  db.close();
});

test("a legal advance persists the new state", () => {
  const db = freshDb();
  const { id } = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "b@example.com",
    amountCents: 4900,
  });

  // Drive the full happy path: MATCHED -> ... -> PAID_OUT.
  advanceOrder(db, id, "AUTHORIZE");
  assert.equal(getOrder(db, id)?.status, "AUTHORIZED");

  advanceOrder(db, id, "DELIVER");
  assert.equal(getOrder(db, id)?.status, "DELIVERED");

  advanceOrder(db, id, "CAPTURE");
  assert.equal(getOrder(db, id)?.status, "CAPTURED");

  const final = advanceOrder(db, id, "PAYOUT");
  assert.equal(final.status, "PAID_OUT");
  assert.equal(getOrder(db, id)?.status, "PAID_OUT");
  db.close();
});

test("an illegal advance throws and does NOT mutate stored state", () => {
  const db = freshDb();
  const { id } = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "b@example.com",
    amountCents: 4900,
  });

  // CAPTURE is illegal from MATCHED (must authorize + deliver first).
  assert.throws(() => advanceOrder(db, id, "CAPTURE"), InvalidTransitionError);
  assert.equal(getOrder(db, id)?.status, "MATCHED"); // unchanged

  // PAYOUT is illegal from AUTHORIZED, too.
  advanceOrder(db, id, "AUTHORIZE");
  assert.throws(() => advanceOrder(db, id, "PAYOUT"), InvalidTransitionError);
  assert.equal(getOrder(db, id)?.status, "AUTHORIZED"); // unchanged
  db.close();
});

test("advanceOrder on a missing order throws", () => {
  const db = freshDb();
  assert.throws(
    () => advanceOrder(db, "ord_missing", "AUTHORIZE"),
    /not found/,
  );
  db.close();
});
