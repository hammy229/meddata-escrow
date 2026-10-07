import { test } from "node:test";
import assert from "node:assert/strict";

import { matchDatasets } from "./matcher";

test("ranks the cardiology dataset first for a cardiovascular study", async () => {
  const ranked = await matchDatasets("cardiovascular disease patient cohort");
  assert.equal(ranked[0].datasetId, "ds_cardio_synthea_v1");
});

test("ranks the diabetes dataset first for a diabetes study", async () => {
  const ranked = await matchDatasets(
    "type 2 diabetes HbA1c longitudinal study",
  );
  assert.equal(ranked[0].datasetId, "ds_diabetes_synthea_v1");
});

test("returns every catalog dataset, sorted by score descending", async () => {
  const ranked = await matchDatasets("diabetes");
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[0].rationale.length > 0);
});
