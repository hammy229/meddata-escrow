import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateAlsCohort } from "../synth/als";
import { runFitnessAudit } from "./audit";
import { checkLeakImpact, measureLeakImpact } from "./leak-impact";

const STUDY = "Predict survival from baseline FVC and age at onset";
const FEATURES = ["age_at_onset", "age_band", "sex", "onset_site", "baseline_alsfrs", "baseline_fvc_pct", "last_contact_alsfrs"];

function flawed(seed = 2, subjects = 400) {
  return generateAlsCohort({ seed, variant: "flawed", subjects });
}

const base = (subjects: readonly object[]) => ({
  subjects,
  label: "died",
  timeColumn: "survival_months",
  features: FEATURES,
});

describe("leak impact", () => {
  it("shows a model gains a lot from the planted leak", () => {
    const f = checkLeakImpact({ ...base(flawed().subjects), flagged: ["last_contact_alsfrs"] });
    assert.ok(f);
    assert.equal(f.id, "leak_impact");
    assert.equal(f.severity, "info");
    assert.equal(f.column, "last_contact_alsfrs");
    const m = f.metric as Record<string, number>;
    // The planted column tracks death at any time, so it is a partial leak for a 12-month target.
    assert.ok(m.aucWith > 0.75, `with ${m.aucWith}`);
    assert.ok(m.aucWithout < 0.75, `without ${m.aucWithout}`);
    assert.ok(m.gap > 0.08, `gap ${m.gap}`);
    assert.ok(m.gapLow <= m.gap && m.gap <= m.gapHigh);
    assert.match(f.reason, /is a leak, not signal/);
    assert.match(f.reason, /censored before month 12/);
  });

  it("is deterministic", () => {
    const a = checkLeakImpact({ ...base(flawed().subjects), flagged: ["last_contact_alsfrs"] });
    const b = checkLeakImpact({ ...base(flawed().subjects), flagged: ["last_contact_alsfrs"] });
    assert.deepEqual(a, b);
  });

  it("emits nothing when no column is flagged", () => {
    const clean = generateAlsCohort({ seed: 3, variant: "clean" });
    assert.equal(checkLeakImpact({ ...base(clean.subjects), flagged: [] }), null);
  });

  it("says a flagged but harmless column adds little", () => {
    const clean = generateAlsCohort({ seed: 3, variant: "clean", subjects: 600 });
    const f = checkLeakImpact({ ...base(clean.subjects), flagged: ["baseline_fvc_pct"] });
    assert.ok(f);
    assert.match(f.title, /adds little/);
    assert.doesNotMatch(f.reason, /is a leak/);
  });

  it("skips with a reason when there are too few events", () => {
    const f = checkLeakImpact({ ...base(flawed(2, 40).subjects), flagged: ["last_contact_alsfrs"] });
    assert.ok(f);
    assert.equal(f.severity, "info");
    assert.match(f.title, /not measured/);
    assert.match(f.reason, /Too few subjects/);
    assert.equal(f.metric?.aucWith, undefined);
  });

  it("drops subjects censored before month 12 and counts them", () => {
    const r = measureLeakImpact({ ...base(flawed().subjects), flagged: ["last_contact_alsfrs"] });
    assert.ok(!("skipped" in r));
    const subs = flawed().subjects;
    const censoredEarly = subs.filter((s) => s.died === 0 && s.survival_months <= 12).length;
    assert.equal(r.censoredDropped, censoredEarly);
    assert.equal(r.cases + r.nonCases + r.censoredDropped, subs.length);
  });

  it("skips when nothing is left after removing flagged columns", () => {
    const r = measureLeakImpact({
      ...base(flawed().subjects),
      features: ["last_contact_alsfrs"],
      flagged: ["last_contact_alsfrs"],
    });
    assert.ok("skipped" in r);
  });

  it("never emits row-level data and hides small counts", () => {
    const f = checkLeakImpact({ ...base(flawed().subjects), flagged: ["last_contact_alsfrs"] });
    assert.ok(f);
    const text = JSON.stringify(f);
    assert.doesNotMatch(text, /SYN-\d/);
    const small = checkLeakImpact({ ...base(flawed(2, 400).subjects.slice(0, 3)), flagged: ["last_contact_alsfrs"] });
    assert.ok(small);
    assert.match(JSON.stringify(small), /fewer than/);
  });
});

describe("leak impact in the audit", () => {
  const run = (variant: "clean" | "flawed", seed: number) => {
    const c = generateAlsCohort({ seed, variant });
    return runFitnessAudit({
      datasetId: "x",
      stage: "delivery",
      synthetic: true,
      study: STUDY,
      subjects: c.subjects,
      visits: c.visits,
      featureTiming: c.featureTiming,
    });
  };

  it("adds one info finding for the flawed cohort and does not change the verdict", () => {
    const r = run("flawed", 2);
    const impact = r.findings.filter((f) => f.id === "leak_impact");
    assert.equal(impact.length, 1);
    assert.equal(impact[0].severity, "info");
    assert.equal(r.verdict, "fail");
    const withoutInfo = r.findings.filter((f) => f.id !== "leak_impact");
    assert.equal(r.verdict, withoutInfo.some((f) => f.severity === "fail") ? "fail" : "warn");
  });

  it("emits nothing for clean cohorts", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = run("clean", seed);
      assert.equal(r.findings.filter((f) => f.id === "leak_impact").length, 0, `seed ${seed}`);
    }
  });
});
