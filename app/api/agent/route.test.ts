// POST /api/agent against an isolated temp DB seeded from the catalog, in
// PAYPAL_MODE=mock with the LLM off (scripted planner) — no network.
import { test } from "node:test";
import assert from "node:assert/strict";

import { POST } from "./route";
import { withAgentDb } from "../../../lib/agent/test-db";
import { getOrder, withDb } from "../../../lib/db/client";

const STUDY = "Cardiology outcomes in a synthetic cohort";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

test(
  "POST runs the agent and opens a MATCHED escrow order within budget",
  withAgentDb(async () => {
    const res = await post({
      study: STUDY,
      budgetCents: 5000,
      buyerEmail: "researcher@example.com",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.runId, /^run_/);
    assert.equal(body.source, "scripted");
    assert.equal(body.recommendation.datasetId, "ds_cardio_synthea_v1");
    assert.equal(typeof body.recommendation.reasoning, "string");
    assert.equal(body.order.amountCents, 4900);
    assert.equal(body.order.escrowState, "MATCHED");
    assert.match(body.order.approveUrl, /^https:\/\//);
    assert.equal(body.steps.length, 4);
    for (const s of body.steps) assert.ok(s.tool && s.at && "input" in s);
    const row = withDb((db) => getOrder(db, body.order.orderId));
    assert.equal(row?.buyer_email, "researcher@example.com");
  }),
);

test(
  "POST returns 200 with no order when nothing fits the budget",
  withAgentDb(async () => {
    const res = await post({ study: STUDY, budgetCents: 100 });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.order, undefined);
    assert.equal(body.recommendation.datasetId, null);
  }),
);

test(
  "POST rejects bad input with 422",
  withAgentDb(async () => {
    const cases: unknown[] = [
      "not json",
      null,
      {},
      { study: "", budgetCents: 5000 },
      { study: "   ", budgetCents: 5000 },
      { study: "x".repeat(1001), budgetCents: 5000 },
      { study: STUDY },
      { study: STUDY, budgetCents: 0 },
      { study: STUDY, budgetCents: -5 },
      { study: STUDY, budgetCents: 49.5 },
      { study: STUDY, budgetCents: "5000" },
      { study: STUDY, budgetCents: 5000, buyerEmail: "nope" },
      { study: 42, budgetCents: 5000 },
    ];
    for (const body of cases) {
      const res = await post(body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.equal(typeof (await res.json()).error, "string");
    }
  }),
);
