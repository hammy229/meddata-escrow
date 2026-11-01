// Demo story spec — in-memory DB seeded with the catalog.
import { test } from "node:test";
import assert from "node:assert/strict";

import { authorizationWindow } from "../escrow/auth-window";
import { listOrderEvents, listOrders, openDb } from "./client";
import { seedDemoStory, STORY_BUYER_EMAIL } from "./demo-story";
import { seedDatabase } from "./seed";
import { listUsage } from "./usage";
import { DEFAULT_BUYER_EMAIL } from "../escrow/service";

function freshDb() {
  const db = openDb(":memory:");
  seedDatabase(db);
  return db;
}

test("the story builds six orders across six states", () => {
  const db = freshDb();
  const story = seedDemoStory(db);
  assert.equal(story.length, 6);
  const counts: Record<string, number> = {};
  for (const o of listOrders(db)) counts[o.status] = (counts[o.status] ?? 0) + 1;
  assert.deepEqual(counts, {
    PAID_OUT: 1,
    CAPTURED: 1,
    DISPUTED: 1,
    AUTHORIZED: 1,
    VOIDED: 1,
    MATCHED: 1,
  });
  // Every amount is the dataset's listed price.
  for (const o of listOrders(db)) {
    const price = (
      db
        .prepare(`SELECT price_cents FROM datasets WHERE id = ?`)
        .get(o.dataset_id) as { price_cents: number }
    ).price_cents;
    assert.equal(o.amount_cents, price);
  }
  db.close();
});

test("the authorized hold has about two days left in its window", () => {
  const db = freshDb();
  const now = new Date("2026-10-30T12:00:00Z");
  seedDemoStory(db, now);
  const held = listOrders(db, { status: "AUTHORIZED" });
  assert.equal(held.length, 1);
  const authorize = listOrderEvents(db, held[0].id).find(
    (e) => e.event === "AUTHORIZE",
  );
  const w = authorizationWindow(authorize?.created_at, now);
  assert.equal(w?.daysLeft, 2);
  assert.equal(w?.state, "valid");
  db.close();
});

test("the dispute carries a note and the captured order has query usage", () => {
  const db = freshDb();
  seedDemoStory(db);
  const disputed = listOrders(db, { status: "DISPUTED" })[0];
  const dispute = listOrderEvents(db, disputed.id).find(
    (e) => e.event === "DISPUTE",
  );
  assert.ok(dispute?.note && dispute.note.length > 0);
  const captured = listOrders(db, { status: "CAPTURED" })[0];
  const usage = listUsage(db, captured.id);
  assert.ok(usage.length >= 2);
  assert.ok(usage.every((u) => u.charge_cents > 0));
  const paid = listOrders(db, { status: "PAID_OUT" })[0];
  assert.ok(paid.payout_batch_id);
  db.close();
});

test("the default buyer owns some datasets but not the demo-agent ones", () => {
  const db = freshDb();
  seedDemoStory(db);
  const mine = listOrders(db, { buyerEmail: DEFAULT_BUYER_EMAIL });
  assert.ok(mine.length >= 1);
  const ownedByDefault = new Set(mine.map((o) => o.dataset_id));
  for (const id of [
    "ds_cardio_synthea_v1",
    "ds_hypertension_registry_v1",
    "ds_asthma_pediatric_pilot_v1",
  ])
    assert.equal(ownedByDefault.has(id), false, id);
  assert.ok(listOrders(db, { buyerEmail: STORY_BUYER_EMAIL }).length >= 1);
  db.close();
});

test("the story is an error when its datasets are not seeded", () => {
  const db = openDb(":memory:");
  assert.throws(() => seedDemoStory(db));
  db.close();
});
