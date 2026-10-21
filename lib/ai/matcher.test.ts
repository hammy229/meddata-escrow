import { test } from "node:test";
import assert from "node:assert/strict";

import { matchDatasets } from "./matcher";
import { failingLlm, fakeLlm, promptOf } from "./testing";

const CARDIO = "ds_cardio_synthea_v1";
const DIABETES = "ds_diabetes_synthea_v1";

test("ranks the cardiology dataset first for a cardiovascular study", async () => {
  const ranked = await matchDatasets("cardiovascular disease patient cohort");
  assert.equal(ranked[0].datasetId, CARDIO);
});

test("ranks the diabetes dataset first for a diabetes study", async () => {
  const ranked = await matchDatasets(
    "type 2 diabetes HbA1c longitudinal study",
  );
  assert.equal(ranked[0].datasetId, DIABETES);
});

test("returns every catalog dataset, sorted by score descending", async () => {
  const ranked = await matchDatasets("diabetes");
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[0].rationale.length > 0);
});

// --- Claude ranking (fake client, no network) ---

test("uses the LLM ranking when enabled and tags it source=llm", async () => {
  const { client, calls } = fakeLlm({
    ranking: [
      { datasetId: CARDIO, score: 35, rationale: "Cardio only." },
      { datasetId: DIABETES, score: 92, rationale: "Has HbA1c labs." },
    ],
  });
  const ranked = await matchDatasets("HbA1c trajectories in T2D", {
    client,
    useLlm: true,
  });
  assert.equal(calls.length, 1);
  assert.match(promptOf(calls[0]), /HbA1c trajectories/);
  assert.deepEqual(
    ranked.map((m) => [m.datasetId, m.score, m.source]),
    [
      [DIABETES, 92, "llm"],
      [CARDIO, 35, "llm"],
    ],
  );
  assert.equal(ranked[0].rationale, "Has HbA1c labs.");
});

test("drops hallucinated and duplicate ids and appends skipped datasets", async () => {
  const { client } = fakeLlm({
    ranking: [
      { datasetId: "ds_made_up", score: 99, rationale: "Invented." },
      { datasetId: CARDIO, score: 80, rationale: "Good fit." },
      { datasetId: CARDIO, score: 10, rationale: "Duplicate." },
    ],
  });
  const ranked = await matchDatasets("diabetes", { client, useLlm: true });
  assert.deepEqual(
    ranked.map((m) => m.datasetId),
    [CARDIO, DIABETES],
  );
  assert.equal(ranked[0].score, 80);
  assert.equal(ranked[0].rationale, "Good fit.");
  // The skipped dataset is appended at score 0 with a keyword rationale.
  assert.equal(ranked[1].score, 0);
  assert.equal(ranked[1].source, "keyword");
  assert.match(ranked[1].rationale, /diabetes/);
});

test("falls back to keyword matching when the LLM call throws", async () => {
  const { client, calls } = failingLlm();
  const ranked = await matchDatasets("cardiovascular disease cohort", {
    client,
    useLlm: true,
  });
  assert.equal(calls.length, 1);
  assert.equal(ranked[0].datasetId, CARDIO);
  assert.ok(ranked.every((m) => m.source === "keyword"));
});

test("does not call the LLM when it is disabled", async () => {
  const { client, calls } = fakeLlm({ ranking: [] });
  const ranked = await matchDatasets("diabetes", { client, useLlm: false });
  assert.equal(calls.length, 0);
  assert.equal(ranked[0].datasetId, DIABETES);
  assert.equal(ranked[0].source, "keyword");
});
