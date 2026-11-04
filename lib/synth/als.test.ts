import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { logRank } from "../stats/survival";
import { generateAlsCohort, type AlsCohort } from "./als";
import { createRng, mulberry32 } from "./prng";

const SEED = 2;

function armSurvival(c: AlsCohort, arm: "A" | "B", stratified: boolean) {
  return c.subjects
    .filter((s) => s.arm === arm)
    .map((s) => ({ time: s.survival_months, event: s.died === 1, stratum: stratified ? s.age_band : undefined }));
}

function meanAge(c: AlsCohort, arm: "A" | "B") {
  const xs = c.subjects.filter((s) => s.arm === arm);
  return xs.reduce((t, s) => t + s.age_at_onset, 0) / xs.length;
}

/** Rank AUC of `score` for label 1 (ties count half). */
function auc(scores: number[], labels: number[]) {
  let wins = 0;
  let pairs = 0;
  for (let i = 0; i < scores.length; i += 1) {
    if (labels[i] !== 1) continue;
    for (let j = 0; j < scores.length; j += 1) {
      if (labels[j] !== 0) continue;
      pairs += 1;
      if (scores[i] > scores[j]) wins += 1;
      else if (scores[i] === scores[j]) wins += 0.5;
    }
  }
  return wins / pairs;
}

describe("prng", () => {
  it("replays the same stream for a seed", () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 20; i += 1) assert.equal(a(), b());
  });

  it("stays inside [0, 1) and differs across seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let same = 0;
    for (let i = 0; i < 1000; i += 1) {
      const x = a();
      assert.ok(x >= 0 && x < 1);
      if (x === b()) same += 1;
    }
    assert.ok(same < 5);
  });

  it("int stays in range and normal centers on the mean", () => {
    const rng = createRng(3);
    for (let i = 0; i < 500; i += 1) {
      const v = rng.int(2, 5);
      assert.ok(v >= 2 && v <= 5 && Number.isInteger(v));
    }
    let sum = 0;
    for (let i = 0; i < 4000; i += 1) sum += rng.normal(10, 2);
    assert.ok(Math.abs(sum / 4000 - 10) < 0.15);
  });
});

describe("generateAlsCohort", () => {
  it("is byte-identical for the same seed and variant", () => {
    for (const variant of ["clean", "flawed"] as const) {
      const a = JSON.stringify(generateAlsCohort({ seed: 11, variant }));
      const b = JSON.stringify(generateAlsCohort({ seed: 11, variant }));
      assert.equal(a, b);
    }
  });

  it("differs for a different seed", () => {
    const a = JSON.stringify(generateAlsCohort({ seed: 11, variant: "clean" }));
    const b = JSON.stringify(generateAlsCohort({ seed: 12, variant: "clean" }));
    assert.notEqual(a, b);
  });

  it("labels every output synthetic and avoids the PII column name", () => {
    for (const variant of ["clean", "flawed"] as const) {
      const c = generateAlsCohort({ seed: SEED, variant });
      assert.equal(c.synthetic, true);
      assert.ok(!("patient_id" in c.subjects[0]));
      assert.ok(!("patient_id" in c.visits[0]));
      assert.match(c.subjects[0].subject_key, /^SYN-\d{5}$/);
      assert.equal(new Set(c.subjects.map((s) => s.subject_key)).size, c.subjects.length);
    }
  });

  it("produces visits that belong to subjects and start at month 0", () => {
    const c = generateAlsCohort({ seed: SEED, variant: "clean", subjects: 50 });
    const keys = new Set(c.subjects.map((s) => s.subject_key));
    assert.ok(c.visits.every((v) => keys.has(v.subject_key)));
    for (const s of c.subjects) {
      const months = c.visits.filter((v) => v.subject_key === s.subject_key).map((v) => v.visit_month);
      assert.equal(months[0], 0);
      assert.ok(Math.max(...months) <= s.survival_months);
    }
    assert.equal(generateAlsCohort({ seed: SEED, variant: "clean", subjects: 50 }).subjects.length, 50);
  });

  it("has some events and some censoring", () => {
    const c = generateAlsCohort({ seed: SEED, variant: "clean" });
    const died = c.subjects.filter((s) => s.died === 1).length;
    assert.ok(died > 100 && died < c.subjects.length - 50);
  });

  describe("flawed variant", () => {
    const c = generateAlsCohort({ seed: SEED, variant: "flawed" });

    it("has a follow-up-derived feature that leaks the outcome", () => {
      const leaks = c.subjects.map((s) => s.last_contact_alsfrs);
      assert.ok(leaks.every((x) => typeof x === "number"));
      const score = auc(
        leaks.map((x) => -(x as number)),
        c.subjects.map((s) => s.died),
      );
      assert.ok(score > 0.95, `AUC = ${score}`);
      assert.equal(c.featureTiming.last_contact_alsfrs, "followup");
    });

    it("has mostly missing FVC", () => {
      const missing = c.subjects.filter((s) => s.baseline_fvc_pct === null).length / c.subjects.length;
      const visitMissing = c.visits.filter((v) => v.fvc_pct === null).length / c.visits.length;
      assert.ok(missing > 0.6 && visitMissing > 0.6, `${missing} ${visitMissing}`);
    });

    it("has older subjects in arm B and a raw gap that age band explains", () => {
      assert.ok(meanAge(c, "B") - meanAge(c, "A") > 5);
      const raw = logRank([armSurvival(c, "A", false), armSurvival(c, "B", false)]);
      const strat = logRank([armSurvival(c, "A", true), armSurvival(c, "B", true)]);
      assert.ok(raw.pValue < 0.01, `raw p = ${raw.pValue}`);
      assert.ok(strat.pValue > 0.05, `stratified p = ${strat.pValue}`);
    });
  });

  describe("clean variant", () => {
    const c = generateAlsCohort({ seed: SEED, variant: "clean" });

    it("has no leaking feature", () => {
      assert.ok(c.subjects.every((s) => !("last_contact_alsfrs" in s)));
      assert.deepEqual(c.featureTiming, {});
    });

    it("has mostly recorded FVC", () => {
      const missing = c.subjects.filter((s) => s.baseline_fvc_pct === null).length / c.subjects.length;
      const visitMissing = c.visits.filter((v) => v.fvc_pct === null).length / c.visits.length;
      assert.ok(missing < 0.15 && visitMissing < 0.15);
    });

    it("has balanced arms and no raw survival gap", () => {
      assert.ok(Math.abs(meanAge(c, "B") - meanAge(c, "A")) < 1.5);
      const raw = logRank([armSurvival(c, "A", false), armSurvival(c, "B", false)]);
      assert.ok(raw.pValue > 0.05, `raw p = ${raw.pValue}`);
    });
  });
});
