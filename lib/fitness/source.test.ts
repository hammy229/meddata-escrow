import assert from "node:assert/strict";
import { test } from "node:test";

import { logRank } from "../stats/survival";
import { runFitnessAudit } from "./audit";
import { fixtureCohort, fixtureSpec, listingClaims } from "./source";

const FLAWED = "ds_als_survival_axonpoint_v1";
const CLEAN = "ds_als_survival_motorneuron_v1";
const CURATED = "ds_als_survival_curated_v1";
const STUDY = "Predict survival from baseline FVC and age at onset";

function audit(id: string, stage: "sample" | "delivery") {
  const c = fixtureCohort(id, stage)!;
  return runFitnessAudit({
    datasetId: id,
    stage,
    synthetic: c.synthetic,
    study: STUDY,
    subjects: c.subjects,
    visits: c.visits,
    featureTiming: c.featureTiming,
    claims: listingClaims(id),
  });
}

test("listings without a fixture have none", () => {
  assert.equal(fixtureSpec("ds_cardio_synthea_v1"), null);
  assert.equal(fixtureCohort("ds_cardio_synthea_v1", "delivery"), null);
  assert.equal(listingClaims("ds_cardio_synthea_v1"), null);
});

test("cohorts are cached and every row is labeled synthetic", () => {
  for (const id of [FLAWED, CLEAN, CURATED]) {
    assert.equal(fixtureCohort(id, "delivery"), fixtureCohort(id, "delivery"));
    assert.equal(fixtureCohort(id, "delivery")!.synthetic, true);
    assert.equal(fixtureCohort(id, "delivery")!.subjects.length, listingClaims(id)!.subjects);
  }
});

test("the curated sample is clean and its delivery is flawed", () => {
  assert.equal(fixtureCohort(CURATED, "sample")!.variant, "clean");
  assert.equal(fixtureCohort(CURATED, "delivery")!.variant, "flawed");
  assert.equal(fixtureCohort(FLAWED, "sample")!.variant, "flawed");
  assert.equal(fixtureCohort(CLEAN, "delivery")!.variant, "clean");
});

test("the audit fails the flawed listing, passes the clean one, and tells the curated stages apart", () => {
  assert.equal(audit(FLAWED, "delivery").verdict, "fail");
  assert.equal(audit(CLEAN, "delivery").verdict, "pass");
  assert.equal(audit(CURATED, "sample").verdict, "pass");
  assert.equal(audit(CURATED, "delivery").verdict, "fail");
});

test("the flawed deliveries show a raw arm gap that age band explains; the clean ones do not", () => {
  const p = (id: string, strat: boolean) => {
    const c = fixtureCohort(id, "delivery")!;
    const g = (arm: string) =>
      c.subjects
        .filter((s) => s.arm === arm)
        .map((s) => ({ time: s.survival_months, event: s.died === 1, stratum: strat ? s.age_band : undefined }));
    return logRank([g("A"), g("B")]).pValue;
  };
  for (const id of [FLAWED, CURATED]) {
    assert.ok(p(id, false) < 0.01, `${id} raw`);
    assert.ok(p(id, true) > 0.05, `${id} stratified`);
  }
  assert.ok(p(CLEAN, false) > 0.05);
});
