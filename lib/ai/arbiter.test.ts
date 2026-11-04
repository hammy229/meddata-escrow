import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  arbitrate,
  enforceAdvisory,
  MIN_CONFIDENCE,
  type ArbiterAudit,
  type ArbiterInput,
  type Recommendation,
} from "./arbiter";
import { AUDIT_NOTE_PREFIX } from "../escrow/audit-note";
import { auditDelivery } from "../escrow/delivery-audit";
import type { Finding } from "../fitness/types";
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

// --- Delivery audit evidence -------------------------------------------------

const claimFinding = (over: Partial<Finding>): Finding => ({
  id: "claim",
  severity: "fail",
  title: "x",
  reason: "r",
  ...over,
});
function auditWith(
  findings: Finding[],
  over: Partial<ArbiterAudit> = {},
): ArbiterAudit {
  return {
    verdict: "fail",
    blocking: findings.some((f) => f.severity === "fail"),
    report: {
      datasetId: "ds_1",
      stage: "delivery",
      synthetic: true,
      verdict: "fail",
      findings,
      disclaimer: "screen, not proof",
      methodVersion: 1,
    },
    ...over,
  };
}
const coverageMiss = (claimed: number, delivered: number) =>
  claimFinding({
    column: "baseline_fvc_pct",
    title: "baseline_fvc_pct coverage is below the listing",
    reason: `The listing says ${claimed}%; the delivered rows have ${delivered}%.`,
    metric: { claimedPct: claimed, deliveredPct: delivered },
  });
const eventMiss = () =>
  claimFinding({ title: "Event rate differs from the listing" });
const withSystemNote = () => [
  ...input().events.slice(0, 3),
  ev(
    "DISPUTE",
    4,
    `${AUDIT_NOTE_PREFIX} the delivered data breaks 2 claims in the listing. A person decides what happens next.`,
  ),
];

test("two claim misses favor a refund even when the sample passed", async () => {
  const stored = auditDelivery({
    id: "ord_1",
    dataset_id: "ds_als_survival_curated_v1",
  })!;
  const r = await arbitrate(
    input({ events: withSystemNote(), audit: stored }),
    rules,
  );
  assert.equal(r.outcome, "refund");
  assert.ok(r.confidence >= MIN_CONFIDENCE);
  assert.equal(r.source, "rules");
  assert.ok(r.evidence.some((e) => /claim/i.test(e)));
  assert.equal(r.advisoryOnly, true);
});

test("the audit branch comes before the missing-sample branch", async () => {
  const r = await arbitrate(
    input({
      sample: null,
      audit: auditWith([coverageMiss(92, 60), eventMiss()]),
    }),
    rules,
  );
  assert.equal(r.outcome, "refund");
});

test("a broken integrity promise is a refund on its own", async () => {
  for (const title of [
    "Listing says no post-index features, but one is present",
    "Listing says one row per subject, but subjects repeat",
  ]) {
    const r = await arbitrate(
      input({ audit: auditWith([claimFinding({ title })]) }),
      rules,
    );
    assert.equal(r.outcome, "refund", title);
  }
});

test("one narrow miss is a split, sized by how far short the data fell", async () => {
  const r = await arbitrate(
    input({ audit: auditWith([coverageMiss(92, 80)]) }),
    rules,
  );
  assert.equal(r.outcome, "split");
  assert.equal(r.suggestedCaptureCents, Math.round((4900 * 80) / 92));
  assert.ok(r.confidence >= MIN_CONFIDENCE);
});

test("the split figure stays between 1 cent and one cent short of the price", async () => {
  const none = await arbitrate(
    input({ audit: auditWith([coverageMiss(92, 0)]) }),
    rules,
  );
  assert.equal(none.suggestedCaptureCents, 1);
  const over = await arbitrate(
    input({ audit: auditWith([coverageMiss(50, 90)]) }),
    rules,
  );
  assert.equal(over.suggestedCaptureCents, 4899);
  const odd = await arbitrate(
    input({
      audit: auditWith([
        claimFinding({
          title: "Listed subjects do not match the delivered rows",
          metric: { claimed: 400, delivered: "fewer than 5" },
        }),
      ]),
    }),
    rules,
  );
  assert.equal(odd.outcome, "split");
  assert.equal(odd.suggestedCaptureCents, 2450);
});

test("an inconclusive audit goes to a person", async () => {
  const r = await arbitrate(
    input({
      audit: { verdict: "inconclusive", blocking: false, report: null },
    }),
    rules,
  );
  assert.equal(r.outcome, "needs_human");
});

test("a warning-only audit leaves the usual reasoning in place", async () => {
  const r = await arbitrate(
    input({
      audit: auditWith([claimFinding({ severity: "warn" })], {
        verdict: "warn",
        blocking: false,
      }),
    }),
    rules,
  );
  assert.equal(r.outcome, "split"); // the buyer's missing-values note, as before
});

test("a system note never counts as the buyer's words", async () => {
  const noted = [
    ...input().events.slice(0, 3),
    ev("DISPUTE", 3, `${AUDIT_NOTE_PREFIX} identifier missing mismatch.`),
  ];
  const r = await arbitrate(
    input({
      events: noted,
      audit: auditWith([], { verdict: "pass", blocking: false }),
    }),
    rules,
  );
  assert.equal(r.outcome, "release");
  assert.ok(!r.evidence.some((e) => e.includes("Buyer's dispute note")));
  assert.ok(r.evidence.some((e) => e.includes("Buyer gave no dispute note")));
});

test("a buyer note beside a system note is still read", async () => {
  const both = [
    ...input().events.slice(0, 3),
    ev("DISPUTE", 3, `${AUDIT_NOTE_PREFIX} something`),
    ev("DISPUTE", 4, "Please look at the re-identification risk"),
  ];
  const r = await arbitrate(input({ events: both }), rules);
  assert.equal(r.outcome, "needs_human");
  assert.ok(r.evidence.some((e) => e.includes("re-identification risk")));
});

test("an LLM release against a blocking audit becomes needs_human; refund and split stand", async () => {
  const audit = auditWith([coverageMiss(92, 60), eventMiss()]);
  const release = fakeLlm({
    outcome: "release",
    confidence: 0.95,
    rationale: "fine",
    evidence: [],
  });
  const r = await arbitrate(input({ audit }), {
    useLlm: true,
    client: release.client,
  });
  assert.equal(r.source, "llm");
  assert.equal(r.outcome, "needs_human");
  assert.match(r.rationale, /audit/i);
  const prompt = promptOf(release.calls[0]);
  assert.match(prompt, /Delivery audit/);
  assert.match(prompt, /coverage is below the listing/);
  for (const outcome of ["refund", "split"]) {
    const llm = fakeLlm({
      outcome,
      confidence: 0.9,
      rationale: "x",
      evidence: [],
    });
    const got = await arbitrate(input({ audit }), {
      useLlm: true,
      client: llm.client,
    });
    assert.equal(got.outcome, outcome);
  }
});

test("an LLM release without a blocking audit is untouched", async () => {
  const llm = fakeLlm({
    outcome: "release",
    confidence: 0.9,
    rationale: "fine",
    evidence: [],
  });
  const r = await arbitrate(
    input({ audit: auditWith([], { verdict: "pass", blocking: false }) }),
    { useLlm: true, client: llm.client },
  );
  assert.equal(r.outcome, "release");
});

test("off-schema LLM output with an audit falls back to the audit rules", async () => {
  const audit = auditWith([coverageMiss(92, 60), eventMiss()]);
  const r = await arbitrate(input({ audit }), {
    useLlm: true,
    client: fakeLlm({ outcome: "burn_it_all", confidence: 1 }).client,
  });
  assert.equal(r.source, "rules");
  assert.equal(r.outcome, "refund");
});

test("the LLM prompt does not carry the system note text as the buyer's words", async () => {
  const llm = fakeLlm({
    outcome: "needs_human",
    confidence: 0.9,
    rationale: "x",
    evidence: [],
  });
  await arbitrate(
    input({
      events: withSystemNote(),
      audit: auditWith([coverageMiss(92, 60)]),
    }),
    { useLlm: true, client: llm.client },
  );
  assert.ok(
    !promptOf(llm.calls[0]).includes("A person decides what happens next"),
  );
});
