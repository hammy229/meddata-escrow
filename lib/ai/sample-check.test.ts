// Sample check spec — no network: the profile is synthesized from the catalog
// and the LLM is a fake client.
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog } from "./matcher";
import {
  checkSample,
  MIN_RECORDS,
  rulesVerdict,
  sampleProfile,
  type SampleProfile,
} from "./sample-check";
import { failingLlm, fakeLlm, promptOf } from "./testing";

const CARDIO = "ds_cardio_synthea_v1";

function cardioProfile(): SampleProfile {
  return sampleProfile(loadCatalog().find((d) => d.id === CARDIO)!);
}

test("the mock sample profile is deterministic", () => {
  assert.deepEqual(cardioProfile(), cardioProfile());
});

const BUILT_TO_FAIL = [
  "ds_asthma_pediatric_pilot_v1",
  "ds_copd_exacerbations_v1",
];

test("the pediatric pilot fails on record count", async () => {
  const v = await checkSample("ds_asthma_pediatric_pilot_v1", {
    useLlm: false,
  });
  assert.equal(v.passed, false);
  assert.ok(v.findings.some((f) => /^FAIL: record count 640/.test(f)));
});

test("the COPD panel fails on its mock sample's duplicate rate", async () => {
  const entry = loadCatalog().find((d) => d.id === "ds_copd_exacerbations_v1")!;
  assert.equal(sampleProfile(entry).duplicateRowPct, 3.4);
  const v = await checkSample(entry.id, { useLlm: false });
  assert.equal(v.passed, false);
  assert.ok(v.findings.some((f) => /^FAIL: duplicate rows 3\.4%/.test(f)));
});

test("catalog datasets pass the rules check", async () => {
  for (const { id } of loadCatalog()) {
    if (BUILT_TO_FAIL.includes(id)) continue;
    const v = await checkSample(id, { useLlm: false });
    assert.equal(v.passed, true, v.findings.join("; "));
    assert.equal(v.source, "rules");
    assert.ok(v.score >= 90 && v.score <= 100, String(v.score));
    assert.ok(v.findings.every((f) => f.startsWith("PASS")));
  }
});

test("rules fail a small, incomplete, non-synthetic sample with identifiers", () => {
  const v = rulesVerdict({
    ...cardioProfile(),
    recordCount: MIN_RECORDS - 1,
    tags: ["cardiology"],
    syntheticData: false,
    fieldCompletenessPct: { age: 55, sex: 100 },
    duplicateRowPct: 5,
    identifierColumns: ["mrn"],
  });
  assert.equal(v.passed, false);
  assert.equal(v.findings.filter((f) => f.startsWith("FAIL")).length, 6);
  assert.ok(v.findings.some((f) => /"age" at 55%/.test(f)));
  assert.ok(v.findings.some((f) => /mrn/.test(f)));
  assert.equal(v.score, 0);
});

test("unknown dataset ids throw", async () => {
  await assert.rejects(checkSample("ds_nope", { useLlm: false }), /unknown/);
});

test("Claude's review is used when enabled and sees the study needs", async () => {
  const { client, calls } = fakeLlm({
    passed: true,
    score: 84,
    findings: ["Covers cardiovascular encounters the study needs."],
  });
  const v = await checkSample(CARDIO, {
    client,
    useLlm: true,
    studyDescription: "statin adherence after MI",
  });
  assert.match(promptOf(calls[0]), /statin adherence/);
  assert.match(promptOf(calls[0]), /fieldCompletenessPct/);
  assert.deepEqual(v, {
    passed: true,
    score: 84,
    findings: ["Covers cardiovascular encounters the study needs."],
    source: "llm",
  });
});

test("Claude can fail a sample the rules pass", async () => {
  const { client } = fakeLlm({
    passed: false,
    score: 30,
    findings: ["No medication data for an adherence study."],
  });
  const v = await checkSample(CARDIO, { client, useLlm: true });
  assert.equal(v.passed, false);
  assert.equal(v.score, 30);
  assert.equal(v.source, "llm");
});

test("Claude cannot raise the score above the rules score", async () => {
  const rules = await checkSample(CARDIO, { useLlm: false });
  const { client } = fakeLlm({ passed: true, score: 100, findings: [] });
  const v = await checkSample(CARDIO, { client, useLlm: true });
  assert.equal(v.score, Math.min(100, rules.score));
});

test("an LLM failure or malformed review falls back to the rules verdict", async () => {
  const rules = await checkSample(CARDIO, { useLlm: false });
  for (const { client } of [
    failingLlm(),
    fakeLlm({ passed: "yes", score: 500 }),
  ]) {
    assert.deepEqual(
      await checkSample(CARDIO, { client, useLlm: true }),
      rules,
    );
  }
});

test("the SYNTHETIC ALS listings pass the rules check", async () => {
  for (const id of [
    "ds_als_survival_axonpoint_v1",
    "ds_als_survival_motorneuron_v1",
    "ds_als_survival_curated_v1",
  ]) {
    const entry = loadCatalog().find((d) => d.id === id)!;
    assert.ok(entry.recordCount >= MIN_RECORDS, id);
    assert.ok(entry.tags.includes("synthetic"), id);
    const v = await checkSample(id, { useLlm: false });
    assert.equal(v.passed, true, `${id}: ${v.findings.join("; ")}`);
    assert.ok(v.findings.every((f) => f.startsWith("PASS")));
  }
});
