import { test } from "node:test";
import assert from "node:assert/strict";

import { buildReplay, summarize } from "./replay";
import type { StoredAgentRun } from "./store";

const at = "2026-10-29T00:00:00.000Z";

const run: StoredAgentRun = {
  runId: "run_abc",
  study: "Cardiology outcomes",
  budgetCents: 6000,
  source: "scripted",
  orderId: "ord_1",
  createdAt: "2026-10-29 14:03:00",
  recommendation: { datasetId: "ds_a", reasoning: "Best fit within budget." },
  steps: [
    {
      tool: "search_datasets",
      input: { study: "Cardiology outcomes" },
      output: {
        matches: [
          {
            datasetId: "ds_a",
            title: "Alpha",
            score: 5,
            rationale: "cardiology terms",
            priceCents: 4900,
            withinBudget: true,
          },
        ],
        budgetCents: 6000,
      },
      at,
    },
    {
      tool: "create_escrow_order",
      input: { datasetId: "ds_a" },
      error:
        "no passing sample check for ds_a in this run; run check_sample first",
      at,
    },
    {
      tool: "check_sample",
      input: {},
      output: { datasetId: "ds_a", passed: true, findings: ["PASS: size"] },
      at,
    },
    {
      tool: "create_escrow_order",
      input: { datasetId: "ds_a" },
      output: { orderId: "ord_1", datasetId: "ds_a", amountCents: 4900 },
      at,
    },
  ],
};

test("steps are numbered, labelled and mark refusals", () => {
  const r = buildReplay(run);
  assert.deepEqual(
    r.steps.map((s) => [s.n, s.label, s.refused]),
    [
      [1, "Searched the catalog", false],
      [2, "Opened an escrow order", true],
      [3, "Checked a sample", false],
      [4, "Opened an escrow order", false],
    ],
  );
  assert.match(r.steps[0].detail, /matches: 1/);
  assert.match(r.steps[1].detail, /^Refused: no passing sample check/);
});

test("guardrails show which ones fired", () => {
  const g = Object.fromEntries(
    buildReplay(run).guardrails.map((x) => [x.label, x]),
  );
  assert.equal(g["Sample check first"].status, "triggered");
  assert.equal(g["Budget cap"].status, "enforced");
  assert.equal(
    g["Budget cap"].detail,
    "Orders priced above $60.00 are refused.",
  );
  assert.equal(g["One order per run"].status, "enforced");
  assert.equal(g["No money movement"].status, "enforced");
});

test("recommendation, shortlist, order and timestamp come through", () => {
  const r = buildReplay(run);
  assert.equal(r.createdAt, "2026-10-29 14:03:00 UTC");
  assert.equal(r.orderId, "ord_1");
  assert.deepEqual(r.recommendation, {
    datasetId: "ds_a",
    title: "Alpha",
    reasoning: "Best fit within budget.",
  });
  assert.equal(r.shortlist[0].datasetId, "ds_a");
  assert.equal(r.shortlist[0].chosen, true);
});

test("a run with no recommendation or steps still builds", () => {
  const r = buildReplay({
    ...run,
    steps: [],
    recommendation: null,
    orderId: null,
    createdAt: "odd",
  });
  assert.deepEqual(r.steps, []);
  assert.deepEqual(r.shortlist, []);
  assert.deepEqual(r.recommendation, {
    datasetId: null,
    title: null,
    reasoning: "",
  });
  assert.equal(r.createdAt, "odd");
});

test("summarize skips prose, nulls and nested objects", () => {
  assert.equal(
    summarize({ a: 1, description: "long", b: null, c: { d: 1 }, e: [1, 2] }),
    "a: 1 · e: 2",
  );
  assert.equal(summarize(undefined), "");
});
