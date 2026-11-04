import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateAlsCohort } from "../synth/als";
import { DISCLAIMER, runFitnessAudit, type AuditInput } from "./audit";
import type { Finding, ListingClaims } from "./types";

const STUDY = "Predict survival from baseline FVC and age at onset";

function inputFor(variant: "clean" | "flawed", extra: Partial<AuditInput> = {}): AuditInput {
  const c = generateAlsCohort({ seed: 2, variant });
  return {
    datasetId: `ds_${variant}`,
    stage: "delivery",
    synthetic: true,
    study: STUDY,
    subjects: c.subjects,
    visits: c.visits,
    featureTiming: c.featureTiming,
    ...extra,
  };
}

const failing = (findings: Finding[], id: Finding["id"]) =>
  findings.filter((f) => f.id === id && f.severity === "fail");

describe("runFitnessAudit", () => {
  it("passes the clean cohort", () => {
    const r = runFitnessAudit(inputFor("clean"));
    assert.equal(r.verdict, "pass", JSON.stringify(r.findings.filter((f) => f.severity !== "pass")));
    assert.equal(r.synthetic, true);
    assert.equal(r.methodVersion, 1);
  });

  it("does not fail the clean cohort on other seeds", () => {
    for (const seed of [1, 3, 4, 5]) {
      const c = generateAlsCohort({ seed, variant: "clean" });
      const r = runFitnessAudit({ ...inputFor("clean"), subjects: c.subjects, visits: c.visits });
      assert.notEqual(r.verdict, "fail", `seed ${seed}`);
    }
  });

  it("fails the flawed cohort on each planted flaw", () => {
    const r = runFitnessAudit(inputFor("flawed"));
    assert.equal(r.verdict, "fail");
    assert.deepEqual(failing(r.findings, "coverage").map((f) => f.column), ["baseline_fvc_pct"]);
    assert.deepEqual(failing(r.findings, "temporal_leak").map((f) => f.column), ["last_contact_alsfrs"]);
    assert.deepEqual(failing(r.findings, "label_association").map((f) => f.column), ["last_contact_alsfrs"]);
    assert.ok(failing(r.findings, "imbalance").some((f) => f.column === "age_at_onset"));
  });

  it("does not fail the flawed cohort's coverage when FVC is not needed", () => {
    const r = runFitnessAudit(inputFor("flawed", { study: "Compare survival by age and sex" }));
    assert.equal(failing(r.findings, "coverage").length, 0);
    // The leak and the imbalance are still found.
    assert.equal(r.verdict, "fail");
  });

  it("carries a screen, not proof disclaimer", () => {
    const r = runFitnessAudit(inputFor("clean"));
    assert.equal(r.disclaimer, DISCLAIMER);
    assert.match(r.disclaimer, /screen, not proof/);
  });

  it("is not applicable for empty tables or a missing label", () => {
    assert.equal(runFitnessAudit({ ...inputFor("clean"), subjects: [] }).verdict, "not_applicable");
    assert.equal(runFitnessAudit({ ...inputFor("clean"), label: "nope" }).verdict, "not_applicable");
  });

  it("fails repeated subject keys", () => {
    const base = inputFor("clean");
    const dup = [...base.subjects, ...base.subjects.slice(0, 30)];
    const r = runFitnessAudit({ ...base, subjects: dup });
    assert.equal(failing(r.findings, "subject_overlap").length, 1);
  });

  it("never serializes a subject key", () => {
    const r = runFitnessAudit(inputFor("flawed"));
    assert.ok(!JSON.stringify(r).includes("SYN-"));
  });

  it("warns on too few events per variable", () => {
    const base = inputFor("clean");
    const few = base.subjects.filter((s) => (s as { died: number }).died === 0);
    const events = base.subjects.filter((s) => (s as { died: number }).died === 1).slice(0, 25);
    const r = runFitnessAudit({ ...base, subjects: [...few.slice(0, 100), ...events] });
    const epv = r.findings.find((f) => f.id === "epv");
    assert.equal(epv?.severity, "warn");
  });

  describe("claims", () => {
    const honest = (variant: "clean" | "flawed"): ListingClaims => {
      const c = generateAlsCohort({ seed: 2, variant });
      return {
        subjects: c.subjects.length,
        records: c.visits.length,
        eventRatePct: Math.round((c.subjects.filter((s) => s.died).length / c.subjects.length) * 1000) / 10,
        coveragePct: { baseline_fvc_pct: 96 },
        noPostIndexFeatures: true,
        uniqueSubjects: true,
      };
    };

    it("passes when the rows match the listing", () => {
      const r = runFitnessAudit(inputFor("clean", { claims: honest("clean") }));
      assert.deepEqual(r.findings.filter((f) => f.id === "claim").map((f) => f.severity), ["pass"]);
    });

    it("fails when the delivered rows break the listing", () => {
      const r = runFitnessAudit(inputFor("flawed", { claims: { ...honest("clean"), subjects: 400, records: 2000 } }));
      const claims = r.findings.filter((f) => f.id === "claim");
      assert.ok(claims.some((f) => f.column === "baseline_fvc_pct" && f.severity === "fail"));
      assert.ok(claims.some((f) => /no post-index/.test(f.title)));
      assert.ok(claims.some((f) => /records/.test(f.title)));
      assert.equal(r.verdict, "fail");
    });

    it("grades a small event-rate gap as a warning", () => {
      const c = honest("clean");
      const r = runFitnessAudit(inputFor("clean", { claims: { ...c, eventRatePct: c.eventRatePct + 3.5 } }));
      const claim = r.findings.find((f) => f.id === "claim");
      assert.equal(claim?.severity, "warn");
    });
  });
});
