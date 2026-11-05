import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCatalog } from "../ai/matcher";
import { failingLlm, fakeLlm } from "../ai/testing";
import { overlapRank } from "./retrieval-baseline";
import {
  evaluateRanker,
  loadGolden,
  runRetrieval,
  type GoldenQuery,
  type Ranker,
} from "./retrieval";

const catalog = loadCatalog();
const ids = new Set(catalog.map((d) => d.id));

test("the golden set is well formed", () => {
  const golden = loadGolden();
  assert.ok(golden.queries.length >= 30);
  const seen = new Set<string>();
  for (const q of golden.queries) {
    assert.ok(!seen.has(q.id), `duplicate id ${q.id}`);
    seen.add(q.id);
    assert.ok(q.query.trim().length > 0);
    for (const [id, grade] of Object.entries(q.relevance)) {
      assert.ok(ids.has(id), `${q.id}: unknown dataset ${id}`);
      assert.ok(grade === 1 || grade === 2, `${q.id}: grade ${grade}`);
    }
  }
  const none = golden.queries.filter((q) => q.kind === "none");
  assert.ok(none.length >= 5);
  assert.ok(none.every((q) => Object.keys(q.relevance).length === 0));
  const answerable = golden.queries.filter((q) => q.kind !== "none");
  assert.ok(answerable.every((q) => Object.keys(q.relevance).length > 0));
  const text = golden.queries.map((q) => q.query.toLowerCase());
  for (const needle of [
    "lou gehrig",
    "motor neuron disease",
    "congestive heart failure",
    "kids with wheezing",
    "pediatric oncology imaging",
  ]) {
    assert.ok(
      text.some((t) => t.includes(needle)),
      needle,
    );
  }
});

test("the baseline is the old word-overlap count", () => {
  const ranked = overlapRank("cardiology synthetic cohort", catalog);
  assert.equal(ranked[0].datasetId, "ds_cardio_synthea_v1");
  assert.equal(ranked[0].score, 3);
  assert.ok(overlapRank("the and with", catalog).every((m) => m.score === 0));
});

const tiny: GoldenQuery[] = [
  { id: "t1", kind: "literal", query: "one", relevance: { a: 2, b: 1 } },
  { id: "t2", kind: "paraphrase", query: "two", relevance: { b: 2 } },
  { id: "t3", kind: "none", query: "three", relevance: {} },
  { id: "t4", kind: "none", query: "four", relevance: {} },
];

const stub = (
  table: Record<string, { datasetId: string; score: number }[]>,
): Ranker => ({
  name: "stub",
  description: "test ranker",
  scoreScale: "percent",
  rank: async (q) => table[q],
});

test("evaluateRanker computes metrics by hand-checkable cases", async () => {
  const r = await evaluateRanker(
    stub({
      one: [
        { datasetId: "a", score: 90 },
        { datasetId: "b", score: 50 },
      ],
      two: [
        { datasetId: "x", score: 40 },
        { datasetId: "b", score: 30 },
      ],
      three: [{ datasetId: "a", score: 20 }],
      four: [{ datasetId: "a", score: 0 }],
    }),
    tiny,
  );
  assert.equal(r.queries.answerable, 2);
  assert.equal(r.queries.noAnswer, 2);
  assert.equal(r.metrics.mrr, 0.75); // (1 + 1/2) / 2
  assert.equal(r.metrics.hitAt1, 0.5);
  assert.equal(r.metrics.recallAt1, 0.25); // (1/2 + 0) / 2
  assert.equal(r.metrics.recallAt3, 1);
  assert.equal(r.noAnswer.falseRelevantRate, 0.5); // only "three" has score > 0
  const at20 = r.noAnswer.curve.find((c) => c.threshold === 20)!;
  assert.equal(at20.falseRelevantRate, 0); // 20 is not strictly above 20
  assert.equal(r.byKind.literal.n, 1);
  assert.equal(r.byKind.paraphrase.mrr, 0.5);
  assert.equal(r.perQuery.length, 4);
  assert.deepEqual(
    r.perQuery[0].top3.map((t) => t.datasetId),
    ["a", "b"],
  );
});

test("a count-scale ranker gets no threshold curve", async () => {
  const r = await evaluateRanker(
    { ...stub({ one: [], two: [], three: [], four: [] }), scoreScale: "count" },
    tiny,
  );
  assert.deepEqual(r.noAnswer.curve, []);
});

test("a ranker that throws is counted, not hidden", async () => {
  const bad: Ranker = {
    name: "bad",
    description: "",
    scoreScale: "percent",
    rank: async () => {
      throw new Error("boom");
    },
  };
  const r = await evaluateRanker(bad, tiny);
  assert.equal(r.errors, 4);
  assert.equal(r.metrics.mrr, 0);
});

test("the report runs the offline rankers and says Claude was skipped", async () => {
  const report = await runRetrieval({ env: {} });
  assert.deepEqual(report.rankersRun, ["overlap_baseline", "bm25"]);
  assert.equal(report.claudeEvaluated, false);
  assert.equal(report.rankersSkipped.length, 1);
  assert.equal(report.rankersSkipped[0].name, "claude");
  assert.match(report.rankersSkipped[0].reason, /not evaluated/i);
  assert.equal(report.catalogSize, 9);
  assert.match(report.caveats.join(" "), /9 listings/);
  assert.match(report.caveats.join(" "), /regression check, not a benchmark/);
  assert.equal(report.results.length, 2);
});

test("with the LLM enabled, Claude is evaluated through the injected client", async () => {
  const { client, calls } = fakeLlm({
    ranking: catalog.map((d, i) => ({
      datasetId: d.id,
      score: 100 - i,
      rationale: "r",
    })),
  });
  const report = await runRetrieval({
    env: { LLM_PROVIDER: "bedrock" },
    client,
  });
  assert.equal(report.claudeEvaluated, true);
  assert.deepEqual(report.rankersRun, ["overlap_baseline", "bm25", "claude"]);
  assert.equal(calls.length, loadGolden().queries.length);
  assert.equal(report.rankersSkipped.length, 0);
});

test("a failing Claude does not silently fall back to keywords", async () => {
  const { client } = failingLlm();
  const report = await runRetrieval({
    env: { LLM_PROVIDER: "bedrock" },
    client,
  });
  const claude = report.results.find((r) => r.ranker === "claude")!;
  assert.equal(claude.errors, loadGolden().queries.length);
  assert.equal(report.claudeEvaluated, false);
  assert.match(report.rankersSkipped.map((s) => s.reason).join(" "), /failed/);
});

// --- regression floors (observed values at the time of writing in comments) ---

test("BM25 stays at least as good as word overlap on the golden set", async () => {
  const report = await runRetrieval({ env: {} });
  const base = report.results.find((r) => r.ranker === "overlap_baseline")!;
  const bm25 = report.results.find((r) => r.ranker === "bm25")!;
  assert.ok(bm25.metrics.mrr! >= base.metrics.mrr!);
  assert.ok(bm25.metrics.recallAt3! >= base.metrics.recallAt3!);
  assert.ok(bm25.metrics.ndcgAt3! >= base.metrics.ndcgAt3!);
});

test("BM25 floors on the golden set", async () => {
  const { results } = await runRetrieval({ env: {} });
  const m = results.find((r) => r.ranker === "bm25")!.metrics;
  assert.ok(m.mrr! >= 0.75, `mrr ${m.mrr}`); // observed 0.778
  assert.ok(m.recallAt3! >= 0.75, `recall@3 ${m.recallAt3}`); // 0.774
  assert.ok(m.ndcgAt3! >= 0.7, `ndcg@3 ${m.ndcgAt3}`); // 0.736
});

test("evals/results/retrieval.json matches what the code produces now", async () => {
  const committed = JSON.parse(
    readFileSync("evals/results/retrieval.json", "utf8"),
  );
  const fresh = JSON.parse(JSON.stringify(await runRetrieval({ env: {} })));
  delete committed.generatedAt;
  delete fresh.generatedAt;
  assert.deepEqual(
    committed,
    fresh,
    "rerun: node --import tsx scripts/eval/retrieval.ts",
  );
});
