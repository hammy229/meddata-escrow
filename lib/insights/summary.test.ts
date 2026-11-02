// Insights aggregation spec: pure function over plain rows, plus the DB loader
// against the demo story seed.
import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb } from "../db/client";
import { seedDemoStory } from "../db/demo-story";
import { seedDatabase } from "../db/seed";
import { loadInsights, summarizeInsights, type InsightsInput } from "./summary";

const empty: InsightsInput = {
  orders: [],
  datasets: [],
  vendors: [],
  events: [],
  usage: [],
};

const base: InsightsInput = {
  vendors: [
    { id: "v1", name: "Alpha" },
    { id: "v2", name: "Beta" },
  ],
  datasets: [
    { id: "d1", vendor_id: "v1", title: "One" },
    { id: "d2", vendor_id: "v2", title: "Two" },
  ],
  orders: [
    { id: "o1", dataset_id: "d1", status: "PAID_OUT", amount_cents: 10_000 },
    { id: "o2", dataset_id: "d1", status: "AUTHORIZED", amount_cents: 5_000 },
    { id: "o3", dataset_id: "d2", status: "DISPUTED", amount_cents: 2_000 },
    { id: "o4", dataset_id: "d2", status: "VOIDED", amount_cents: 9_999 },
    { id: "o5", dataset_id: "d2", status: "MATCHED", amount_cents: 1_234 },
    { id: "o6", dataset_id: "d2", status: "CAPTURED", amount_cents: 3_333 },
  ],
  events: [
    { order_id: "o1", event: "AUTHORIZE", created_at: "2026-10-01 00:00:00" },
    { order_id: "o1", event: "DELIVER", created_at: "2026-10-01 06:00:00" },
    { order_id: "o2", event: "AUTHORIZE", created_at: "2026-10-02 00:00:00" },
    { order_id: "o3", event: "AUTHORIZE", created_at: "2026-10-02 00:00:00" },
    { order_id: "o3", event: "DELIVER", created_at: "2026-10-02 12:00:00" },
    { order_id: "o3", event: "DISPUTE", created_at: "2026-10-03 00:00:00" },
    { order_id: "o4", event: "AUTHORIZE", created_at: "2026-10-02 00:00:00" },
    { order_id: "o6", event: "AUTHORIZE", created_at: "2026-10-02 00:00:00" },
  ],
  usage: [
    { order_id: "o1", charge_cents: 50 },
    { order_id: "o1", charge_cents: 50 },
    { order_id: "o6", charge_cents: 50 },
  ],
};

test("an empty database yields zeros, null time and no rows", () => {
  const s = summarizeInsights(empty);
  assert.equal(s.orderCount, 0);
  assert.equal(s.gmvCents, 0);
  assert.equal(s.heldCents, 0);
  assert.equal(s.releasedCents, 0);
  assert.equal(s.platformFeeCents, 0);
  assert.equal(s.disputeRate, 0);
  assert.equal(s.avgTimeToDeliverHours, null);
  assert.equal(s.queryCount, 0);
  assert.equal(s.queryRevenueCents, 0);
  assert.deepEqual(s.topDatasets, []);
  assert.deepEqual(s.byVendor, []);
  assert.equal(s.byStatus.length, 8);
  assert.ok(s.byStatus.every((r) => r.count === 0 && r.amountCents === 0));
});

test("held and released split GMV; voided and unpaid orders are excluded", () => {
  const s = summarizeInsights(base);
  assert.equal(s.orderCount, 6);
  assert.equal(s.heldCents, 5_000 + 2_000);
  assert.equal(s.releasedCents, 10_000 + 3_333);
  assert.equal(s.gmvCents, s.heldCents + s.releasedCents);
  assert.equal(s.refundedCents, 9_999);
});

test("platform fee is earned only on released orders", () => {
  const s = summarizeInsights(base);
  // 10% of 10000 = 1000; 10% of 3333 = 333.3 -> 333
  assert.equal(s.platformFeeCents, 1_333);
});

test("dispute rate is disputed orders over orders that were ever authorized", () => {
  const s = summarizeInsights(base);
  // authorized: o1 o2 o3 o4 o6 (5); disputed: o3
  assert.equal(s.disputeRate, 1 / 5);
});

test("a resolved dispute still counts via its DISPUTE event", () => {
  const input: InsightsInput = {
    ...base,
    events: [
      ...base.events,
      { order_id: "o6", event: "DISPUTE", created_at: "2026-10-03 00:00:00" },
    ],
  };
  assert.equal(summarizeInsights(input).disputeRate, 2 / 5);
});

test("average time to deliver is the mean AUTHORIZE to DELIVER gap in hours", () => {
  const s = summarizeInsights(base);
  // o1: 6h, o3: 12h -> 9h; orders never delivered are skipped
  assert.equal(s.avgTimeToDeliverHours, 9);
});

test("a delivery stamped before its authorization is ignored, not negative", () => {
  const s = summarizeInsights({
    ...base,
    events: [
      { order_id: "o1", event: "AUTHORIZE", created_at: "2026-10-02 00:00:00" },
      { order_id: "o1", event: "DELIVER", created_at: "2026-10-01 00:00:00" },
    ],
  });
  assert.equal(s.avgTimeToDeliverHours, null);
});

test("byStatus is zero-filled and sums to the order count", () => {
  const s = summarizeInsights(base);
  const get = (st: string) => s.byStatus.find((r) => r.status === st)!;
  assert.equal(get("PAID_OUT").count, 1);
  assert.equal(get("CANCELLED").count, 0);
  assert.equal(get("VOIDED").amountCents, 9_999);
  assert.equal(
    s.byStatus.reduce((n, r) => n + r.count, 0),
    s.orderCount,
  );
});

test("query usage is totalled", () => {
  const s = summarizeInsights(base);
  assert.equal(s.queryCount, 3);
  assert.equal(s.queryRevenueCents, 150);
});

test("top datasets rank by GMV, carry vendor and query counts, and honor the limit", () => {
  const s = summarizeInsights(base);
  assert.deepEqual(
    s.topDatasets.map((d) => d.datasetId),
    ["d1", "d2"],
  );
  const d1 = s.topDatasets[0];
  assert.equal(d1.title, "One");
  assert.equal(d1.vendorName, "Alpha");
  assert.equal(d1.orders, 2);
  assert.equal(d1.gmvCents, 15_000);
  assert.equal(d1.queries, 2);
  assert.equal(summarizeInsights(base, { topN: 1 }).topDatasets.length, 1);
});

test("by vendor rolls up money, fee, net and disputes", () => {
  const s = summarizeInsights(base);
  const beta = s.byVendor.find((v) => v.vendorId === "v2")!;
  assert.equal(beta.name, "Beta");
  assert.equal(beta.heldCents, 2_000);
  assert.equal(beta.releasedCents, 3_333);
  assert.equal(beta.feeCents, 333);
  assert.equal(beta.netCents, 3_000);
  assert.equal(beta.disputes, 1);
  assert.equal(beta.orders, 4);
  assert.equal(s.byVendor[0].vendorId, "v1", "sorted by GMV descending");
});

test("datasets with no orders are left out of the rankings", () => {
  const s = summarizeInsights({
    ...base,
    orders: base.orders.filter((o) => o.dataset_id === "d1"),
  });
  assert.deepEqual(
    s.topDatasets.map((d) => d.datasetId),
    ["d1"],
  );
  assert.deepEqual(
    s.byVendor.map((v) => v.vendorId),
    ["v1"],
  );
});

test("an order for an unknown dataset still counts toward totals", () => {
  const s = summarizeInsights({
    ...empty,
    orders: [
      { id: "x", dataset_id: "gone", status: "CAPTURED", amount_cents: 1_000 },
    ],
  });
  assert.equal(s.releasedCents, 1_000);
  assert.equal(s.topDatasets[0].title, "gone");
  assert.equal(s.byVendor[0].name, "Unknown vendor");
});

test("loadInsights on a freshly seeded empty book is all zeros", () => {
  const db = openDb(":memory:");
  seedDatabase(db);
  const s = loadInsights(db);
  assert.equal(s.orderCount, 0);
  assert.equal(s.gmvCents, 0);
  db.close();
});

test("loadInsights reads the demo story from the database", () => {
  const db = openDb(":memory:");
  seedDatabase(db);
  seedDemoStory(db);
  const s = loadInsights(db);
  assert.equal(s.orderCount, 6);
  assert.ok(s.releasedCents > 0);
  assert.ok(s.heldCents > 0);
  assert.ok(s.platformFeeCents > 0);
  assert.equal(s.queryCount, 3);
  assert.equal(s.queryRevenueCents, 150);
  // one dispute among five ever-authorized orders
  assert.equal(s.disputeRate, 1 / 5);
  assert.ok(s.topDatasets.length > 0);
  db.close();
});
