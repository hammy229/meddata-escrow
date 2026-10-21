import { test } from "node:test";
import assert from "node:assert/strict";

import { getOrder, listOrders, withDb } from "../db/client";
import { fakeLlm } from "../ai/testing";
import { withAgentDb } from "./test-db";
import { AGENT_TOOLS, createAgentContext, executeTool } from "./tools";

const CARDIO = "ds_cardio_synthea_v1"; // 4900 cents
const DIABETES = "ds_diabetes_synthea_v1"; // 5900 cents
const STUDY = "Cardiology outcomes in a synthetic cohort";

function ctx(budgetCents = 10_000) {
  return createAgentContext({
    study: STUDY,
    budgetCents,
    ai: { useLlm: false },
  });
}

test("tool definitions are strict, closed schemas requiring every field", () => {
  assert.deepEqual(
    AGENT_TOOLS.map((t) => t.name),
    ["search_datasets", "get_dataset", "check_sample", "create_escrow_order"],
  );
  for (const t of AGENT_TOOLS) {
    assert.equal(t.strict, true);
    assert.equal(t.input_schema.additionalProperties, false);
    assert.deepEqual(
      t.input_schema.required,
      Object.keys(t.input_schema.properties ?? {}),
    );
  }
});

test(
  "search_datasets ranks the catalog with prices and budget fit",
  withAgentDb(async () => {
    const c = ctx(5000);
    const r = await executeTool(c, "search_datasets", { study: STUDY });
    assert.ok(r.ok);
    const { matches } = r.output as {
      matches: {
        datasetId: string;
        priceCents: number;
        withinBudget: boolean;
      }[];
    };
    assert.equal(matches[0].datasetId, CARDIO);
    assert.equal(matches[0].priceCents, 4900);
    assert.equal(matches[0].withinBudget, true);
    const diabetes = matches.find((m) => m.datasetId === DIABETES);
    assert.equal(diabetes?.withinBudget, false);
    assert.equal(c.steps.length, 1);
    assert.equal(c.steps[0].tool, "search_datasets");
    assert.ok(c.steps[0].output && !c.steps[0].error && c.steps[0].at);
  }),
);

test(
  "get_dataset returns details and errors on an unknown id",
  withAgentDb(async () => {
    const c = ctx();
    const ok = await executeTool(c, "get_dataset", { datasetId: CARDIO });
    assert.ok(ok.ok);
    assert.equal((ok.output as { priceCents: number }).priceCents, 4900);
    const bad = await executeTool(c, "get_dataset", { datasetId: "ds_nope" });
    assert.deepEqual(bad, { ok: false, error: "unknown datasetId: ds_nope" });
    assert.equal(c.steps[1].error, "unknown datasetId: ds_nope");
  }),
);

test(
  "invalid input and unknown tools become recorded error results",
  withAgentDb(async () => {
    const c = ctx();
    const extra = await executeTool(c, "get_dataset", {
      datasetId: CARDIO,
      priceCents: 1,
    });
    assert.equal(extra.ok, false);
    const missing = await executeTool(c, "check_sample", { datasetId: CARDIO });
    assert.equal(missing.ok, false);
    const unknown = await executeTool(c, "capture_payment", {});
    assert.deepEqual(unknown, {
      ok: false,
      error: "unknown tool: capture_payment",
    });
    assert.equal(c.steps.length, 3);
    assert.ok(c.steps.every((s) => s.error && s.output === undefined));
  }),
);

test(
  "happy path: sample check then order creates a MATCHED escrow order",
  withAgentDb(async () => {
    const c = createAgentContext({
      study: STUDY,
      budgetCents: 5000,
      buyerEmail: "researcher@example.com",
      ai: { useLlm: false },
    });
    const sample = await executeTool(c, "check_sample", {
      datasetId: CARDIO,
      study: STUDY,
    });
    assert.ok(sample.ok);
    assert.equal((sample.output as { passed: boolean }).passed, true);

    const r = await executeTool(c, "create_escrow_order", {
      datasetId: CARDIO,
      justification: "Cardiology cohort fits the study",
    });
    assert.ok(r.ok, JSON.stringify(r));
    const out = r.output as {
      orderId: string;
      approveUrl: string;
      escrowState: string;
      amountCents: number;
    };
    assert.equal(out.escrowState, "MATCHED");
    assert.equal(out.amountCents, 4900);
    assert.match(out.approveUrl, /^https:\/\/sandbox\.paypal\.com\//);
    const row = withDb((db) => getOrder(db, out.orderId));
    assert.equal(row?.status, "MATCHED");
    assert.equal(row?.buyer_email, "researcher@example.com");
    assert.equal(row?.amount_cents, 4900);
    assert.equal(c.order?.orderId, out.orderId);
  }),
);

test(
  "guardrail: refuses an order over budget (even with a passing sample)",
  withAgentDb(async () => {
    const c = ctx(5000);
    await executeTool(c, "check_sample", { datasetId: DIABETES, study: STUDY });
    assert.ok(c.passedSamples.has(DIABETES));
    const r = await executeTool(c, "create_escrow_order", {
      datasetId: DIABETES,
      justification: "x",
    });
    assert.deepEqual(r, {
      ok: false,
      error: "price 5900 cents exceeds the budget of 5000 cents",
    });
    assert.equal(c.order, undefined);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "guardrail: refuses an order without a prior passing sample check",
  withAgentDb(async () => {
    const c = ctx();
    const r = await executeTool(c, "create_escrow_order", {
      datasetId: CARDIO,
      justification: "x",
    });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /no passing sample check/);

    // A pass for a DIFFERENT dataset does not count.
    await executeTool(c, "check_sample", { datasetId: DIABETES, study: STUDY });
    const r2 = await executeTool(c, "create_escrow_order", {
      datasetId: CARDIO,
      justification: "x",
    });
    assert.equal(r2.ok, false);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "guardrail: a failed sample check does not unlock an order",
  withAgentDb(async () => {
    // Claude's reviewer can only tighten the rules verdict: a "fail" review
    // makes the check fail even though the rules pass.
    const c = createAgentContext({
      study: STUDY,
      budgetCents: 10_000,
      ai: {
        useLlm: true,
        client: fakeLlm({ passed: false, score: 10, findings: ["unfit"] })
          .client,
      },
    });
    const s = await executeTool(c, "check_sample", {
      datasetId: CARDIO,
      study: STUDY,
    });
    assert.ok(s.ok);
    assert.equal((s.output as { passed: boolean }).passed, false);
    const r = await executeTool(c, "create_escrow_order", {
      datasetId: CARDIO,
      justification: "x",
    });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /no passing sample check/);
  }),
);

test(
  "guardrail: at most one order per run",
  withAgentDb(async () => {
    const c = ctx();
    await executeTool(c, "check_sample", { datasetId: CARDIO, study: STUDY });
    await executeTool(c, "check_sample", { datasetId: DIABETES, study: STUDY });
    const first = await executeTool(c, "create_escrow_order", {
      datasetId: CARDIO,
      justification: "x",
    });
    assert.ok(first.ok);
    for (const datasetId of [CARDIO, DIABETES]) {
      const again = await executeTool(c, "create_escrow_order", {
        datasetId,
        justification: "x",
      });
      assert.equal(again.ok, false);
      assert.match((again as { error: string }).error, /at most one order/);
    }
    assert.equal(withDb((db) => listOrders(db)).length, 1);
  }),
);

test(
  "guardrail: refuses an unknown dataset",
  withAgentDb(async () => {
    const c = ctx();
    c.passedSamples.add("ds_ghost"); // even if state were somehow tampered
    const r = await executeTool(c, "create_escrow_order", {
      datasetId: "ds_ghost",
      justification: "x",
    });
    assert.deepEqual(r, { ok: false, error: "unknown datasetId: ds_ghost" });
    const s = await executeTool(c, "check_sample", {
      datasetId: "ds_ghost",
      study: STUDY,
    });
    assert.equal(s.ok, false);
  }),
);
