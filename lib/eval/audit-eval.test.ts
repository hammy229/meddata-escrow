import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runFitnessAudit } from "../fitness/audit";
import { generateAlsCohort } from "../synth/als";
import {
  aucOfSeparation,
  auditPlanted,
  blocksMoney,
  buildConditions,
  formatAuditTable,
  roundedForFile,
  runAuditEval,
  truthfulClaims,
} from "./audit-eval";
import { createRng } from "../synth/prng";

const small = { seeds: 6, sizes: [100, 200], leakImpactSeeds: 2, fresh: false };

describe("audit eval", () => {
  const result = runAuditEval(small);

  it("is deterministic", () => {
    assert.deepEqual(runAuditEval(small), result);
  });

  it("says it is synthetic and states its limits", () => {
    assert.equal(result.synthetic, true);
    assert.match(result.limitations, /SYNTHETIC/);
    assert.match(result.limitations, /do not measure performance on real data/);
  });

  it("holds no money on a truthful listing over clean data", () => {
    for (const n of ["100", "200"])
      assert.equal(result.summary.falseBlockTruthful[n].k, 0);
  });

  it("catches duplicates and a broken one-row-per-subject promise", () => {
    const dup = result.conditions.find((c) => c.id === "dup_0.05")!;
    assert.equal(dup.bySize["100"].flagged.subject_overlap.rate, 1);
    const promise = result.conditions.find(
      (c) => c.id === "claim_unique_0.02",
    )!;
    assert.equal(promise.bySize["100"].blocked.rate, 1);
  });

  it("holds money for a claim far off and not for one barely off", () => {
    const far = result.conditions.find((c) => c.id === "claim_subjects_0.25")!;
    const near = result.conditions.find((c) => c.id === "claim_subjects_0.01")!;
    assert.equal(far.bySize["200"].blocked.rate, 1);
    assert.equal(near.bySize["200"].blocked.rate, 0);
  });

  it("shows a bigger leak widens the AUC gap and a control stays flat", () => {
    const rows = result.leakImpact["200"];
    const control = rows[0];
    const strongest = rows[rows.length - 1];
    assert.ok(Math.abs(control.meanGap) < 0.05, String(control.meanGap));
    assert.ok(strongest.meanGap > control.meanGap + 0.03);
  });

  it("re-checks the tuned imbalance rule on seeds it was not tuned on, and records the tuning", () => {
    const withFresh = runAuditEval({
      ...small,
      sizes: [100],
      seeds: 4,
      fresh: true,
    });
    assert.ok(withFresh.freshSeeds);
    assert.equal(withFresh.freshSeeds.config.baseSeed, 900000);
    assert.notEqual(
      withFresh.freshSeeds.config.baseSeed,
      withFresh.config.baseSeed,
    );
    assert.ok(
      withFresh.freshSeeds.conditions.every(
        (c) => c.family === "clean" || c.family === "imbalance",
      ),
    );
    assert.match(withFresh.tuning, /tuned on base seed 1000/);
  });

  it("prints a table and a stable rounded file form", () => {
    const text = formatAuditTable(result);
    assert.match(text, /FALSE BLOCK/);
    assert.match(text, /SYNTHETIC/);
    const rounded = roundedForFile(result);
    const p = rounded.summary.falseBlockTruthful["100"];
    assert.equal(p.rate, Math.round(p.rate * 1e4) / 1e4);
  });
});

describe("audit eval parts", () => {
  it("builds unique condition ids", () => {
    const ids = buildConditions().map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("derives a truthful listing from the rows", () => {
    const c = generateAlsCohort({ seed: 5, variant: "clean", subjects: 100 });
    const claims = truthfulClaims(c.subjects, c.visits);
    assert.equal(claims.subjects, 100);
    assert.equal(claims.records, c.visits.length);
    assert.equal(claims.coveragePct.baseline_fvc_pct % 5, 0);
    const o = auditPlanted({
      subjects: c.subjects as never,
      visits: c.visits,
      claims,
    });
    assert.equal(o.blocked, false);
  });

  it("does not change the clean rows when planting a flaw", () => {
    const c = generateAlsCohort({ seed: 5, variant: "clean", subjects: 100 });
    const before = JSON.stringify(c.subjects);
    const honest = truthfulClaims(c.subjects, c.visits);
    for (const cond of buildConditions())
      cond.plant(c, honest, honest, createRng(1));
    assert.equal(JSON.stringify(c.subjects), before);
  });

  it("blocksMoney follows only failed claim findings", () => {
    const c = generateAlsCohort({ seed: 2, variant: "flawed" });
    const report = runFitnessAudit({
      datasetId: "x",
      stage: "delivery",
      synthetic: true,
      study: "Predict survival from baseline FVC and age at onset",
      subjects: c.subjects,
      featureTiming: c.featureTiming,
    });
    assert.equal(report.verdict, "fail");
    assert.equal(blocksMoney(report), false);
  });

  it("maps separation to AUC", () => {
    assert.ok(Math.abs(aucOfSeparation(0) - 0.5) < 1e-6);
    assert.ok(aucOfSeparation(3) > 0.98);
  });
});
