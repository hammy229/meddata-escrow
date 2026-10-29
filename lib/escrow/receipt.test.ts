import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReceipt } from "./receipt";
import { PER_QUERY_FEE_CENTS } from "../db/usage";

const order = (status: Parameters<typeof buildReceipt>[0]["status"]) => ({
  id: "ord_1",
  dataset_id: "ds_1",
  status,
  amount_cents: 4900,
});
const usage = (n: number) =>
  Array.from({ length: n }, () => ({ charge_cents: PER_QUERY_FEE_CENTS }));

test("a captured order splits into fee and payout that add back up", () => {
  const r = buildReceipt(order("CAPTURED"), []);
  assert.equal(r.amountCents, 4900);
  assert.equal(r.platformFeeCents, 490);
  assert.equal(r.vendorPayoutCents, 4410);
  assert.equal(r.platformFeeCents + r.vendorPayoutCents, r.amountCents);
  assert.equal(r.totalCents, 4900);
});

test("fee and payout sum to the amount even when the fee rounds", () => {
  for (const amount_cents of [1, 5, 4905, 9999, 123457]) {
    const r = buildReceipt({ ...order("PAID_OUT"), amount_cents }, []);
    assert.equal(r.platformFeeCents + r.vendorPayoutCents, amount_cents);
  }
});

test("query charges are summed and added to the total", () => {
  const r = buildReceipt(order("DELIVERED"), usage(3));
  assert.equal(r.queryCount, 3);
  assert.equal(r.queryChargesCents, 3 * PER_QUERY_FEE_CENTS);
  assert.equal(r.totalCents, 4900 + 3 * PER_QUERY_FEE_CENTS);
});

test("charges follow the recorded rows, not an assumed flat fee", () => {
  const r = buildReceipt(order("CAPTURED"), [
    { charge_cents: 10 },
    { charge_cents: 75 },
  ]);
  assert.equal(r.queryChargesCents, 85);
});

test("voided and cancelled orders charge nothing", () => {
  for (const status of ["VOIDED", "CANCELLED"] as const) {
    const r = buildReceipt(order(status), usage(2));
    assert.equal(r.amountCents, 0);
    assert.equal(r.platformFeeCents, 0);
    assert.equal(r.vendorPayoutCents, 0);
    assert.equal(r.queryChargesCents, 0);
    assert.equal(r.totalCents, 0);
    assert.equal(r.queryCount, 2);
    assert.equal(r.status, status);
  }
});

test("identifies the order and dataset", () => {
  const r = buildReceipt(order("MATCHED"), []);
  assert.equal(r.orderId, "ord_1");
  assert.equal(r.datasetId, "ds_1");
});
