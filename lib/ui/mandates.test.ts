import { test } from "node:test";
import assert from "node:assert/strict";

import { mandateBody, spentPercent } from "./mandates";

const NOW = new Date("2026-11-03T12:00:00.000Z");

test("the form's dollars become cents and hours become an expiry", () => {
  assert.deepEqual(
    mandateBody({ totalUsd: "100", perOrderUsd: "60.50", hours: 24 }, NOW),
    {
      ok: true,
      body: {
        maxTotalCents: 10_000,
        maxPerOrderCents: 6050,
        expiresAt: "2026-11-04T12:00:00.000Z",
      },
    },
  );
});

test("bad amounts get a message the buyer can act on", () => {
  for (const [totalUsd, perOrderUsd, pattern] of [
    ["", "10", /total budget/],
    ["0", "10", /total budget/],
    ["abc", "10", /total budget/],
    ["10", "-1", /per-order/],
    ["10", "20", /can't be more/],
  ] as const) {
    const r = mandateBody({ totalUsd, perOrderUsd, hours: 1 }, NOW);
    assert.ok(!r.ok);
    assert.match(r.error, pattern);
  }
});

test("the bar stays between 0 and 100", () => {
  assert.equal(spentPercent({ spentCents: 4900, maxTotalCents: 10_000 }), 49);
  assert.equal(spentPercent({ spentCents: 0, maxTotalCents: 10_000 }), 0);
  assert.equal(spentPercent({ spentCents: 200, maxTotalCents: 100 }), 100);
  assert.equal(spentPercent({ spentCents: 5, maxTotalCents: 0 }), 0);
});
