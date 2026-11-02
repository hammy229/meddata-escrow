import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  arbitrate,
  enforceAdvisory,
  MIN_CONFIDENCE,
  type ArbiterInput,
  type Recommendation,
} from "./arbiter";
import { fakeLlm, failingLlm, promptOf } from "./testing";

const ev = (event: string, seq: number, note: string | null = null) => ({
  event,
  seq,
  note,
  created_at: "2026-01-01 00:00:00",
});

function input(over: Partial<ArbiterInput> = {}): ArbiterInput {
  return {
    order: {
      id: "ord_1",
      status: "DISPUTED",
      amount_cents: 4900,
      dataset_id: "ds_1",
    },
    events: [
      ev("CREATE", 0),
      ev("AUTHORIZE", 1),
      ev("DELIVER", 2),
      ev("DISPUTE", 3, "Many rows are missing values"),
    ],
    sample: {
      passed: true,
      score: 95,
      findings: ["PASS: ok"],
      source: "rules",
    },
    ...over,
  };
}

const rules = { useLlm: false };

test("failed sample check on a delivered order favors a refund", async () => {
  const r = await arbitrate(
    input({
      sample: {
        passed: false,
        score: 40,
        findings: ["FAIL: duplicate rows 3.4% (maximum 2%)"],
        source: "rules",
      },
    }),
    rules,
  );
  assert.equal(r.outcome, "refund");
  assert.ok(r.confidence >= MIN_CONFIDENCE);
  assert.ok(r.evidence.some((e) => /duplicate rows/.test(e)));
  assert.equal(r.source, "rules");
});

test("an order never delivered is refunded with high confidence", async () => {
  const r = await arbitrate(
    input({
      events: [
        ev("CREATE", 0),
        ev("AUTHORIZE", 1),
        ev("DISPUTE", 2, "nothing arrived"),
      ],
    }),
    rules,
  );
  assert.equal(r.outcome, "refund");
  assert.ok(r.confidence >= 0.85);
  assert.ok(r.evidence.some((e) => /never delivered|no delivery/i.test(e)));
});

test("passing sample, delivered, no complaint text favors release", async () => {
  const r = await arbitrate(
    input({
      events: [
        ev("CREATE", 0),
        ev("AUTHORIZE", 1),
        ev("DELIVER", 2),
        ev("DISPUTE", 3),
      ],
    }),
    rules,
  );
  assert.equal(r.outcome, "release");
});

test("passing sample but a concrete quality complaint suggests a split", async () => {
  const r = await arbitrate(input(), rules);
  assert.equal(r.outcome, "split");
  assert.ok(r.confidence >= MIN_CONFIDENCE);
});

test("privacy or re-identification complaints go to a human", async () => {
  const r = await arbitrate(
    input({
      events: [
        ev("CREATE", 0),
        ev("AUTHORIZE", 1),
        ev("DELIVER", 2),
        ev("DISPUTE", 3, "I can re-identify patients from the zip codes"),
      ],
    }),
    rules,
  );
  assert.equal(r.outcome, "needs_human");
});

test("missing sample evidence is stated and lowers certainty", async () => {
  const r = await arbitrate(input({ sample: null }), rules);
  assert.ok(r.evidence.some((e) => /sample check/i.test(e)));
  assert.notEqual(r.outcome, "release");
});

test("every recommendation is explicitly advisory", async () => {
  const r = await arbitrate(input(), rules);
  assert.equal(r.advisoryOnly, true);
  assert.ok(r.rationale.length > 20);
  assert.ok(r.evidence.length > 0);
});

test("enforceAdvisory forces needs_human below the confidence floor", () => {
  const low: Recommendation = {
    outcome: "refund",
    confidence: MIN_CONFIDENCE - 0.01,
    rationale: "unsure",
    evidence: ["x"],
    source: "llm",
    advisoryOnly: true,
  };
  const out = enforceAdvisory(low);
  assert.equal(out.outcome, "needs_human");
  assert.match(out.rationale, /confidence/i);
  assert.equal(enforceAdvisory({ ...low, confidence: 0.9 }).outcome, "refund");
});

test("enforceAdvisory clamps confidence into 0..1 and NaN to 0", () => {
  const base: Recommendation = {
    outcome: "release",
    confidence: 5,
    rationale: "r",
    evidence: [],
    source: "llm",
    advisoryOnly: true,
  };
  assert.equal(enforceAdvisory(base).confidence, 1);
  const nan = enforceAdvisory({ ...base, confidence: NaN });
  assert.equal(nan.confidence, 0);
  assert.equal(nan.outcome, "needs_human");
});

test("LLM path: schema-validated answer is used and prompt carries evidence", async () => {
  const llm = fakeLlm({
    outcome: "refund",
    confidence: 0.9,
    rationale: "Sample failed duplicates check.",
    evidence: ["duplicate rows too high"],
  });
  const r = await arbitrate(input(), { useLlm: true, client: llm.client });
  assert.equal(r.source, "llm");
  assert.equal(r.outcome, "refund");
  const p = promptOf(llm.calls[0]);
  assert.match(p, /Many rows are missing values/);
  assert.match(p, /ord_1/);
});

test("LLM low confidence is forced to needs_human in code", async () => {
  const llm = fakeLlm({
    outcome: "release",
    confidence: 0.3,
    rationale: "Not sure.",
    evidence: [],
  });
  const r = await arbitrate(input(), { useLlm: true, client: llm.client });
  assert.equal(r.outcome, "needs_human");
});

test("LLM failure or invalid output falls back to the rules", async () => {
  const bad = await arbitrate(input(), {
    useLlm: true,
    client: failingLlm().client,
  });
  assert.equal(bad.source, "rules");
  const invalid = await arbitrate(input(), {
    useLlm: true,
    client: fakeLlm({ outcome: "burn_it_all", confidence: 1 }).client,
  });
  assert.equal(invalid.source, "rules");
});

test("the arbiter module cannot move money: no escrow service or PayPal imports", () => {
  const src = readFileSync(new URL("./arbiter.ts", import.meta.url), "utf8");
  const imports = src.match(/from\s+"[^"]+"/g) ?? [];
  for (const i of imports) {
    assert.doesNotMatch(i, /escrow\/service|paypal|db\/client/);
  }
});
