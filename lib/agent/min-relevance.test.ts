// The offline matcher flags weak matches, and the scripted agent does not buy
// on one. Before this, any listing sharing a single generic word with the study
// (score > 0) was a candidate: "Alzheimer's disease MRI brain scans" would get
// a COPD dataset because both say "disease".
import { test } from "node:test";
import assert from "node:assert/strict";

import { listOrders, withDb } from "../db/client";
import { MIN_KEYWORD_RELEVANCE, matchDatasets } from "../ai/matcher";
import { withAgentDb } from "./test-db";
import { runProcurementAgent } from "./run";

test("keyword matches carry a relevant flag at the documented cut-off", async () => {
  assert.equal(MIN_KEYWORD_RELEVANCE, 10);
  const strong = await matchDatasets("pediatric asthma inhaler triggers", {
    useLlm: false,
  });
  assert.equal(strong[0].relevant, true);
  const weak = await matchDatasets("Alzheimer's disease MRI brain scans", {
    useLlm: false,
  });
  assert.ok(weak[0].score > 0, "premise: a generic word still scores");
  assert.equal(weak[0].relevant, false);
  assert.ok(weak.every((m) => m.relevant === m.score > MIN_KEYWORD_RELEVANCE));
});

test(
  "the scripted agent does not buy on a weak match",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: "Alzheimer's disease MRI brain scans", budgetCents: 100_000 },
      { useLlm: false },
    );
    assert.equal(r.order, undefined);
    assert.equal(r.recommendation.datasetId, null);
    assert.match(r.recommendation.reasoning, /too weak|no dataset/i);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
    assert.equal(
      r.steps.some((s) => s.tool === "create_escrow_order"),
      false,
    );
  }),
);

test(
  "a strong match is still bought",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: "Cardiology outcomes in a synthetic cohort", budgetCents: 5000 },
      { useLlm: false },
    );
    assert.equal(r.order?.datasetId, "ds_cardio_synthea_v1");
  }),
);

test(
  "the search tool shows the flag to the planner",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: "Alzheimer's disease MRI brain scans", budgetCents: 100_000 },
      { useLlm: false },
    );
    const search = r.steps.find((s) => s.tool === "search_datasets");
    const matches = (search?.output as { matches: { relevant?: boolean }[] })
      .matches;
    assert.equal(matches[0].relevant, false);
  }),
);
