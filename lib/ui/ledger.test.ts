import { test } from "node:test";
import assert from "node:assert/strict";

import { ledgerTotals, TOTAL_ID } from "./ledger";

test("empty ledger totals zero", () => {
  assert.deepEqual(ledgerTotals([]), {
    count: 0,
    amountCents: 0,
    feeCents: 0,
    netCents: 0,
  });
});

test("fee plus net equals amount, even with odd cents", () => {
  const t = ledgerTotals([
    { id: "a", amount_cents: 4905 },
    { id: "b", amount_cents: 1001 },
    { id: "c", amount_cents: 3 },
  ]);
  assert.equal(t.count, 3);
  assert.equal(t.amountCents, 5909);
  assert.equal(t.feeCents + t.netCents, t.amountCents);
});

test("the pinned total row is not counted", () => {
  const t = ledgerTotals([
    { id: "a", amount_cents: 1000 },
    { id: TOTAL_ID, amount_cents: 1000 },
  ]);
  assert.equal(t.count, 1);
  assert.equal(t.amountCents, 1000);
  assert.equal(t.feeCents, 100);
  assert.equal(t.netCents, 900);
});
