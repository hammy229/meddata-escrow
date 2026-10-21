import { test } from "node:test";
import assert from "node:assert/strict";

import { withAgentDb } from "./test-db";
import { runProcurementAgent } from "./run";
import { getAgentRun, saveAgentRun } from "./store";

const STUDY = "Cardiology outcomes in a synthetic cohort";

test(
  "saveAgentRun round-trips a run with its steps, order id, and reasoning",
  withAgentDb(async () => {
    const input = { study: STUDY, budgetCents: 5000 };
    const run = await runProcurementAgent(input, { useLlm: false });
    saveAgentRun(input, run);
    const stored = getAgentRun(run.runId);
    assert.ok(stored);
    assert.equal(stored.runId, run.runId);
    assert.equal(stored.study, STUDY);
    assert.equal(stored.budgetCents, 5000);
    assert.equal(stored.source, "scripted");
    assert.equal(stored.orderId, run.order?.orderId);
    assert.deepEqual(stored.steps, JSON.parse(JSON.stringify(run.steps)));
    assert.deepEqual(stored.recommendation, run.recommendation);
    assert.match(stored.createdAt, /^\d{4}-\d{2}-\d{2}/);
  }),
);

test(
  "a run without an order stores a null order id",
  withAgentDb(async () => {
    const input = { study: STUDY, budgetCents: 100 };
    const run = await runProcurementAgent(input, { useLlm: false });
    saveAgentRun(input, run);
    assert.equal(getAgentRun(run.runId)?.orderId, null);
  }),
);

test(
  "getAgentRun returns undefined for an unknown id (table created on read)",
  withAgentDb(async () => {
    assert.equal(getAgentRun("run_nope"), undefined);
  }),
);

test(
  "a duplicate run id is rejected (runs are append-only)",
  withAgentDb(async () => {
    const input = { study: STUDY, budgetCents: 100 };
    const run = await runProcurementAgent(input, { useLlm: false });
    saveAgentRun(input, run);
    assert.throws(() => saveAgentRun(input, run));
  }),
);
