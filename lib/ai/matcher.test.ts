import { test } from "node:test";
import assert from "node:assert/strict";

import catalogJson from "../../data/catalog.json";
import { fixtureCohort } from "../fitness/source";
import { loadCatalog, matchDatasets } from "./matcher";
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
  assert.equal(ranked.length, loadCatalog().length);
  assert.equal(ranked.length, 9);
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
    ranked.slice(0, 2).map((m) => [m.datasetId, m.score, m.source]),
    [
      [DIABETES, 92, "llm"],
      [CARDIO, 35, "llm"],
    ],
  );
  // Datasets the model did not rank trail behind at score 0.
  assert.equal(ranked.length, loadCatalog().length);
  assert.ok(ranked.slice(2).every((m) => m.score === 0));
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
    [
      CARDIO,
      ...loadCatalog()
        .map((d) => d.id)
        .filter((id) => id !== CARDIO),
    ],
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

test("filler words like 'for' and 'with' never count as a match", async () => {
  const ranked = await matchDatasets("for the and with from this that");
  for (const m of ranked) {
    assert.equal(m.score, 0, `${m.datasetId} matched on filler words`);
  }
});

// --- SYNTHETIC ALS listings ---

const ALS_FLAWED = "ds_als_survival_axonpoint_v1";
const ALS_CLEAN = "ds_als_survival_motorneuron_v1";
const ALS_CURATED = "ds_als_survival_curated_v1";
const ALS_IDS = [ALS_FLAWED, ALS_CLEAN, ALS_CURATED];

type CatalogRow = {
  id: string;
  title: string;
  description: string;
  priceCents: number;
  recordCount: number;
  tags: string[];
  vendorId: string;
  fixture?: unknown;
  claims?: { records: number };
};
const rawCatalog = catalogJson as unknown as CatalogRow[];

test("the ALS listings come last, in order: flawed, clean, curated sample", () => {
  assert.deepEqual(
    loadCatalog()
      .slice(-3)
      .map((d) => d.id),
    ALS_IDS,
  );
});

test("each ALS listing is titled SYNTHETIC, under $60, with a fixture and claims", () => {
  for (const id of ALS_IDS) {
    const d = rawCatalog.find((x) => x.id === id)!;
    assert.match(d.title, /^SYNTHETIC /);
    assert.ok(d.priceCents < 6000, id);
    assert.ok(d.tags.includes("synthetic"));
    assert.ok(d.fixture && d.claims, id);
    assert.ok(d.recordCount >= 1000);
    assert.equal(d.recordCount, fixtureCohort(id, "delivery")!.visits.length);
    assert.equal(d.claims!.records, d.recordCount);
  }
});

test("the flawed ALS listing is the cheapest and the two planted-flaw listings are tagged", () => {
  const price = (id: string) => rawCatalog.find((x) => x.id === id)!.priceCents;
  assert.ok(price(ALS_FLAWED) < price(ALS_CLEAN));
  assert.ok(price(ALS_FLAWED) < price(ALS_CURATED));
  const tagged = rawCatalog
    .filter((d) => d.tags.includes("planted-flaw"))
    .map((d) => d.id);
  assert.deepEqual(tagged, [ALS_FLAWED, ALS_CURATED]);
});

test("two new demo vendors host the three ALS listings", () => {
  const known = new Set(rawCatalog.slice(0, 6).map((d) => d.vendorId));
  const vendors = new Set(rawCatalog.slice(6).map((d) => d.vendorId));
  assert.equal(vendors.size, 2);
  for (const v of vendors) assert.ok(!known.has(v));
});

test("ALS descriptions avoid words that would shift the existing rankings", () => {
  for (const id of ALS_IDS) {
    const d = rawCatalog.find((x) => x.id === id)!;
    const words = new Set(
      `${d.title} ${d.description} ${d.tags.join(" ")}`
        .toLowerCase()
        .match(/[a-z0-9]+/g),
    );
    for (const banned of [
      "disease",
      "patient",
      "cohort",
      "risk",
      "heart",
      "blood",
      "chronic",
    ]) {
      assert.ok(!words.has(banned), `${id} uses "${banned}"`);
    }
  }
});

test("an ALS study ranks the flawed listing first (ties go to catalog order)", async () => {
  const ranked = await matchDatasets(
    "ALS survival with ALSFRS-R and FVC visits",
    { useLlm: false },
  );
  assert.deepEqual(
    ranked.slice(0, 3).map((m) => m.datasetId),
    ALS_IDS,
  );
  assert.ok(ranked[0].score > 0);
  assert.equal(ranked[0].score, ranked[1].score);
});

test("existing studies still rank the same top dataset with the ALS listings present", async () => {
  const asthma = await matchDatasets("pediatric asthma inhaler triggers");
  assert.equal(asthma[0].datasetId, "ds_asthma_pediatric_pilot_v1");
  const hf = await matchDatasets("heart failure readmissions after discharge");
  assert.equal(hf[0].datasetId, "ds_heart_failure_readmissions_v1");
  const copd = await matchDatasets(
    "chronic obstructive pulmonary disease exacerbations",
  );
  assert.equal(copd[0].datasetId, "ds_copd_exacerbations_v1");
});

// --- BM25 offline scoring ---

test("offline scores are numbers in [0, 100] and plurals match singulars", async () => {
  const ranked = await matchDatasets("inhalers for children with triggers", {
    useLlm: false,
  });
  assert.equal(ranked[0].datasetId, "ds_asthma_pediatric_pilot_v1");
  assert.match(ranked[0].rationale, /^Matched on: .*inhalers/);
  for (const m of ranked) {
    assert.ok(Number.isFinite(m.score) && m.score >= 0 && m.score <= 100);
  }
});

test("a study of words the catalog never uses scores 0 everywhere", async () => {
  const ranked = await matchDatasets("zebra xylophone quasar", {
    useLlm: false,
  });
  assert.ok(ranked.every((m) => m.score === 0));
});
