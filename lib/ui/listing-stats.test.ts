import { test } from "node:test";
import assert from "node:assert/strict";

import { listingStats, type StatOrder } from "./listing-stats";

const o = (
  dataset_id: string,
  status: string,
  amount_cents: number,
  created_at = "2026-10-29 10:00:00",
): StatOrder => ({ dataset_id, status, amount_cents, created_at });

test("no orders gives an empty map", () => {
  const stats = listingStats([]);
  assert.equal(stats.size, 0);
  assert.equal(stats.get("ds_x"), undefined);
});

test("mixed states are bucketed per dataset", () => {
  const stats = listingStats([
    o("a", "AUTHORIZED", 1000),
    o("a", "DISPUTED", 500),
    o("a", "CAPTURED", 4900, "2026-10-30 09:00:00"),
    o("a", "PAID_OUT", 1000),
    o("a", "VOIDED", 700),
    o("a", "MATCHED", 300),
    o("b", "CAPTURED", 200),
  ]);
  const a = stats.get("a")!;
  assert.equal(a.orders, 6);
  assert.equal(a.inEscrowCents, 1500);
  assert.equal(a.capturedCents, 5900);
  assert.equal(a.lastOrderAt, "2026-10-30 09:00:00");
  assert.equal(stats.get("b")!.orders, 1);
  assert.equal(stats.get("b")!.capturedCents, 200);
});

test("net plus fee equals captured, with odd cents", () => {
  const stats = listingStats([
    o("a", "CAPTURED", 4905),
    o("a", "PAID_OUT", 1001),
    o("a", "CAPTURED", 3),
  ]);
  const a = stats.get("a")!;
  assert.equal(a.netCents + a.feeCents, a.capturedCents);
  assert.equal(a.feeCents, 491 + 100 + 0);
});

test("voided and held orders earn nothing", () => {
  const a = listingStats([
    o("a", "VOIDED", 900),
    o("a", "AUTHORIZED", 900),
  ]).get("a")!;
  assert.equal(a.netCents, 0);
  assert.equal(a.feeCents, 0);
});
