// DB persistence spec. Uses an in-memory SQLite DB per test (never the dev
// file) and verifies the state machine stays the source of truth: legal
// advances persist, illegal advances throw AND leave stored state untouched.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  openDb,
  createOrder,
  getOrder,
  advanceOrder,
  listOrders,
  listOrderEvents,
  summarizeOrders,
} from "./client";
import {
  InvalidTransitionError,
  ESCROW_STATES,
  type EscrowState,
} from "../escrow/state-machine";

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

test("listOrders returns all orders, newest first", () => {
  const db = freshDb();
  const a = createOrder(db, {
    id: "ord_a",
    datasetId: "ds_x",
    buyerEmail: "a@example.com",
    amountCents: 100,
  });
  const b = createOrder(db, {
    id: "ord_b",
    datasetId: "ds_cardio_synthea_v1",
    buyerEmail: "b@example.com",
    amountCents: 4900,
  });

  const ids = listOrders(db).map((o) => o.id);
  // Same created_at (CURRENT_TIMESTAMP granularity) -> id DESC breaks the tie.
  assert.deepEqual(ids, [b.id, a.id]);
  db.close();
});

test("listOrders filters by status, datasetId, and buyerEmail", () => {
  const db = freshDb();
  createOrder(db, {
    id: "ord_1",
    datasetId: "ds_x",
    buyerEmail: "buyer1@example.com",
    amountCents: 100,
  });
  createOrder(db, {
    id: "ord_2",
    datasetId: "ds_cardio_synthea_v1",
    buyerEmail: "buyer2@example.com",
    amountCents: 4900,
    status: "DISPUTED",
  });

  assert.deepEqual(
    listOrders(db, { status: "DISPUTED" }).map((o) => o.id),
    ["ord_2"],
  );
  assert.deepEqual(
    listOrders(db, { datasetId: "ds_x" }).map((o) => o.id),
    ["ord_1"],
  );
  assert.deepEqual(
    listOrders(db, { buyerEmail: "buyer2@example.com" }).map((o) => o.id),
    ["ord_2"],
  );
  assert.equal(listOrders(db, { status: "PAID_OUT" }).length, 0);
  db.close();
});

test("records a genesis CREATE event when an order is created", () => {
  const db = freshDb();
  const order = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "buyer@example.com",
    amountCents: 100,
  });
  assert.deepEqual(
    listOrderEvents(db, order.id).map((e) => [
      e.event,
      e.from_state,
      e.to_state,
    ]),
    [["CREATE", null, "MATCHED"]],
  );
  db.close();
});

test("appends an audit row for every transition, oldest first", () => {
  const db = freshDb();
  const order = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "buyer@example.com",
    amountCents: 100,
  });
  advanceOrder(db, order.id, "AUTHORIZE");
  advanceOrder(db, order.id, "DELIVER");
  advanceOrder(db, order.id, "CAPTURE");

  assert.deepEqual(
    listOrderEvents(db, order.id).map((e) => [
      e.event,
      e.from_state,
      e.to_state,
    ]),
    [
      ["CREATE", null, "MATCHED"],
      ["AUTHORIZE", "MATCHED", "AUTHORIZED"],
      ["DELIVER", "AUTHORIZED", "DELIVERED"],
      ["CAPTURE", "DELIVERED", "CAPTURED"],
    ],
  );
  db.close();
});

test("an illegal advance writes no audit row", () => {
  const db = freshDb();
  const order = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "buyer@example.com",
    amountCents: 100,
  });
  // CAPTURE is illegal from MATCHED — transition throws before any write.
  assert.throws(
    () => advanceOrder(db, order.id, "CAPTURE"),
    InvalidTransitionError,
  );
  assert.deepEqual(
    listOrderEvents(db, order.id).map((e) => e.event),
    ["CREATE"],
  );
  db.close();
});

test("stores an optional note on a transition (e.g. a dispute reason)", () => {
  const db = freshDb();
  const order = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "buyer@example.com",
    amountCents: 100,
  });
  advanceOrder(db, order.id, "AUTHORIZE");
  advanceOrder(
    db,
    order.id,
    "DISPUTE",
    undefined,
    "dataset rows were truncated",
  );

  const events = listOrderEvents(db, order.id);
  assert.equal(
    events.find((e) => e.event === "DISPUTE")?.note,
    "dataset rows were truncated",
  );
  // The genesis row and routine transitions carry no note.
  assert.equal(events.find((e) => e.event === "CREATE")?.note, null);
  assert.equal(events.find((e) => e.event === "AUTHORIZE")?.note, null);
  db.close();
});

test("summarizeOrders on an empty DB zero-fills every state and bucket", () => {
  const db = freshDb();
  const s = summarizeOrders(db);
  assert.deepEqual(
    Object.keys(s.countsByStatus).sort(),
    [...ESCROW_STATES].sort(),
  );
  assert.ok(Object.values(s.countsByStatus).every((n) => n === 0));
  assert.equal(s.heldCents, 0);
  assert.equal(s.capturedCents, 0);
  assert.equal(s.paidOutCents, 0);
  assert.equal(s.releasedCents, 0);
  db.close();
});

test("summarizeOrders buckets amounts by escrow state, optionally per dataset", () => {
  const db = freshDb();
  const add = (status: EscrowState, amountCents: number, datasetId = "ds_x") =>
    createOrder(db, {
      datasetId,
      buyerEmail: "b@example.com",
      amountCents,
      status,
    });
  add("MATCHED", 1);
  add("AUTHORIZED", 10);
  add("DELIVERED", 20);
  add("DISPUTED", 40);
  add("CAPTURED", 100);
  add("CAPTURED", 200);
  add("PAID_OUT", 1000);
  add("VOIDED", 5000);
  add("CANCELLED", 7);
  add("PAID_OUT", 4900, "ds_cardio_synthea_v1");

  const all = summarizeOrders(db);
  assert.equal(all.countsByStatus.CAPTURED, 2);
  assert.equal(all.countsByStatus.PAID_OUT, 2);
  assert.equal(all.countsByStatus.MATCHED, 1);
  assert.equal(all.heldCents, 10 + 20 + 40);
  assert.equal(all.capturedCents, 100 + 200 + 1000 + 4900);
  assert.equal(all.paidOutCents, 1000 + 4900);
  assert.equal(all.releasedCents, 5000);

  const cardio = summarizeOrders(db, { datasetId: "ds_cardio_synthea_v1" });
  assert.equal(cardio.countsByStatus.PAID_OUT, 1);
  assert.equal(cardio.countsByStatus.CAPTURED, 0);
  assert.equal(cardio.capturedCents, 4900);
  assert.equal(cardio.heldCents, 0);
  db.close();
});
