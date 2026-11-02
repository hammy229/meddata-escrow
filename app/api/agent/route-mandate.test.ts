// POST /api/agent with a spending mandate token.
import { test } from "node:test";
import assert from "node:assert/strict";

import { POST } from "./handlers";
import { withAgentDb } from "../../../lib/agent/test-db";
import { issueMandate } from "../../../lib/agent/mandate";
import { resetMandateLedger } from "../../../lib/agent/mandate-ledger";
import { listOrders, withDb } from "../../../lib/db/client";

const STUDY = "Cardiology outcomes in a synthetic cohort";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function token(extra: Record<string, unknown> = {}) {
  return issueMandate({
    buyerId: "researcher@example.com",
    maxTotalCents: 10_000,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...extra,
  }).token;
}

test(
  "a run within the mandate buys and reports usage",
  withAgentDb(async () => {
    resetMandateLedger();
    const res = await post({
      study: STUDY,
      budgetCents: 9000,
      mandate: token(),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.order.amountCents, 4900);
    assert.equal(body.mandate.spentCents, 4900);
    assert.equal(body.mandate.remainingCents, 5100);
    assert.deepEqual(body.mandate.denied, []);
  }),
);

test(
  "a run outside the mandate is refused in code and explains why",
  withAgentDb(async () => {
    resetMandateLedger();
    const res = await post({
      study: STUDY,
      budgetCents: 9000,
      mandate: token({ maxPerOrderCents: 1000 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.order, undefined);
    assert.equal(body.mandate.spentCents, 0);
    assert.match(body.mandate.denied[0], /per-order/);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "a tampered or garbage mandate token is a 401 and runs nothing",
  withAgentDb(async () => {
    const t = token();
    const [payload, sig] = t.split(".");
    const flipped = `${payload}.${sig.slice(0, -2)}${sig.endsWith("AA") ? "BB" : "AA"}`;
    for (const bad of [flipped, "garbage"]) {
      const res = await post({ study: STUDY, budgetCents: 9000, mandate: bad });
      assert.equal(res.status, 401);
      assert.match((await res.json()).error, /mandate/);
    }
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "runs without a mandate carry no mandate field",
  withAgentDb(async () => {
    const res = await post({ study: STUDY, budgetCents: 9000 });
    assert.equal((await res.json()).mandate, undefined);
  }),
);
