// The mandate is enforced by the buy tool in code: whatever the planner asks,
// an order outside the mandate is refused, recorded, and reported.
import { test } from "node:test";
import assert from "node:assert/strict";

import { listOrders, withDb } from "../db/client";
import { withAgentDb } from "./test-db";
import { issueMandate } from "./mandate";
import { resetMandateLedger, spentUnderMandate } from "./mandate-ledger";
import { createAgentContext, executeTool } from "./tools";
import { runProcurementAgent } from "./run";

const CARDIO = "ds_cardio_synthea_v1"; // 4900 cents, vnd_demo_health
const DIABETES = "ds_diabetes_synthea_v1"; // 5900 cents, vnd_demo_health
const STUDY = "Cardiology outcomes in a synthetic cohort";

function mandate(extra: Record<string, unknown> = {}) {
  return issueMandate({
    buyerId: "researcher@example.com",
    maxTotalCents: 10_000,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...extra,
  }).mandate;
}

function ctx(m = mandate(), budgetCents = 10_000) {
  resetMandateLedger();
  return createAgentContext({
    study: STUDY,
    budgetCents,
    ai: { useLlm: false },
    mandate: m,
  });
}

async function buy(c: ReturnType<typeof ctx>, datasetId = CARDIO) {
  await executeTool(c, "check_sample", { datasetId, study: STUDY });
  return executeTool(c, "create_escrow_order", {
    datasetId,
    justification: "x",
  });
}

test(
  "an order inside the mandate succeeds and is added to the ledger",
  withAgentDb(async () => {
    const m = mandate({ allowedTags: ["cardiology"] });
    const c = ctx(m);
    const r = await buy(c);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(spentUnderMandate(m.id), 4900);
    assert.deepEqual(c.mandateDenials, []);
  }),
);

test(
  "an order over the per-order limit is refused before any escrow is made",
  withAgentDb(async () => {
    const c = ctx(mandate({ maxPerOrderCents: 4000 }));
    const r = await buy(c);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /mandate denied.*per-order/);
    assert.equal(c.order, undefined);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
    assert.equal(c.mandateDenials.length, 1);
  }),
);

test(
  "a vendor or tag outside the mandate is refused",
  withAgentDb(async () => {
    const c = ctx(mandate({ allowedVendors: ["vnd_northstar_labs"] }));
    const r = await buy(c);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /vendor/);

    const c2 = ctx(mandate({ allowedTags: ["oncology"] }));
    const r2 = await buy(c2);
    assert.equal(r2.ok, false);
    assert.match((r2 as { error: string }).error, /tag/);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "the ledger spans runs: a second purchase past the total is refused",
  withAgentDb(async () => {
    const m = mandate({ maxTotalCents: 6000 });
    const first = ctx(m);
    assert.ok((await buy(first)).ok);

    // Same mandate, new run (ledger kept, not reset).
    const second = createAgentContext({
      study: STUDY,
      budgetCents: 10_000,
      ai: { useLlm: false },
      mandate: m,
    });
    const r = await buy(second, DIABETES);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /remaining 1100/);
    assert.equal(spentUnderMandate(m.id), 4900);
  }),
);

test(
  "without a mandate nothing changes and no ledger is touched",
  withAgentDb(async () => {
    resetMandateLedger();
    const c = createAgentContext({
      study: STUDY,
      budgetCents: 10_000,
      ai: { useLlm: false },
    });
    assert.ok((await buy(c)).ok);
    assert.deepEqual(c.mandateDenials, []);
  }),
);

test(
  "the run result reports mandate usage",
  withAgentDb(async () => {
    resetMandateLedger();
    const m = mandate({ maxTotalCents: 8000 });
    const run = await runProcurementAgent(
      { study: STUDY, budgetCents: 10_000, mandate: m },
      { useLlm: false },
    );
    assert.equal(run.order?.datasetId, CARDIO);
    assert.deepEqual(run.mandate, {
      id: m.id,
      maxTotalCents: 8000,
      spentCents: 4900,
      remainingCents: 3100,
      denied: [],
    });
  }),
);

test(
  "the scripted planner falls through to a candidate the mandate allows",
  withAgentDb(async () => {
    resetMandateLedger();
    // Cardio (4900) is best but over the 4000 per-order cap; the planner
    // moves on to the hypertension registry (3900), which fits.
    const m = mandate({ maxPerOrderCents: 4000 });
    const run = await runProcurementAgent(
      { study: STUDY, budgetCents: 10_000, mandate: m },
      { useLlm: false },
    );
    assert.equal(run.order?.datasetId, "ds_hypertension_registry_v1");
    assert.equal(run.mandate?.spentCents, 3900);
    assert.ok(run.mandate!.denied.length >= 1);
    for (const d of run.mandate!.denied) assert.match(d, /per-order/);
    assert.equal(withDb((db) => listOrders(db)).length, 1);
  }),
);
