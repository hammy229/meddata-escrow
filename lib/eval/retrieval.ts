// Retrieval eval: score each ranker on the golden set (evals/golden/matcher.json).
//
// WHAT THIS IS: a regression check. The catalog holds 9 listings and the
// relevance labels are one author's judgment, so differences between rankers
// of a few points are noise. It shows that BM25 is not worse than word overlap
// on the cases the author thought of, and it shows where each ranker fails.
// It is not a benchmark and not evidence about real-world retrieval quality.
//
// Claude is only scored when llmEnabled(); otherwise the report says it was
// not evaluated. A Claude call that fails is counted as an error, never
// replaced by the keyword fallback (that would score BM25 under Claude's name).
import golden from "../../evals/golden/matcher.json";
import heldout from "../../evals/golden/matcher-heldout.json";
import { llmEnabled, type LlmClient } from "../llm/client";
import {
  MIN_KEYWORD_RELEVANCE,
  llmMatch,
  loadCatalog,
  type CatalogEntry,
} from "../ai/matcher";
import { bm25Rank } from "../ai/matcher-bm25";
import { synonymRank } from "../ai/matcher-synonyms";
import {
  aggregate,
  hitAtK,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
  topLooksRelevant,
  type Relevance,
} from "./metrics";
import { overlapRank } from "./retrieval-baseline";

export interface GoldenQuery {
  id: string;
  kind: "literal" | "paraphrase" | "broad" | "adjacent" | "none";
  query: string;
  relevance: Relevance;
}

export function loadGolden(): { description: string; queries: GoldenQuery[] } {
  return structuredClone(golden) as unknown as {
    description: string;
    queries: GoldenQuery[];
  };
}

export function loadHeldout(): { description: string; queries: GoldenQuery[] } {
  return structuredClone(heldout) as unknown as {
    description: string;
    queries: GoldenQuery[];
  };
}

export interface ScoredId {
  datasetId: string;
  score: number;
}

export interface Ranker {
  name: string;
  description: string;
  /** "percent" scores run 0 to 100 and can be thresholded; "count" cannot. */
  scoreScale: "percent" | "count";
  rank(query: string, catalog: CatalogEntry[]): Promise<ScoredId[]>;
}

export const THRESHOLDS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 60];

const round = (n: number | null): number | null =>
  n === null ? null : Math.round(n * 10000) / 10000;

export interface MetricSet {
  mrr: number | null;
  hitAt1: number | null;
  recallAt1: number | null;
  recallAt3: number | null;
  ndcgAt3: number | null;
}

export interface RankerResult {
  ranker: string;
  description: string;
  scoreScale: Ranker["scoreScale"];
  queries: { answerable: number; noAnswer: number };
  /** Queries on which the ranker threw. Their ranking counts as empty. */
  errors: number;
  /** Over the answerable queries. */
  metrics: MetricSet;
  byKind: Record<string, MetricSet & { n: number }>;
  noAnswer: {
    n: number;
    /** Top result has score > 0: it would be shown as a match. */
    falseRelevantRate: number | null;
    /** Same, at stricter score cut-offs (percent-scale rankers only). */
    curve: {
      threshold: number;
      falseRelevantRate: number | null;
      /** Answerable queries whose top result is relevant AND above the cut-off. */
      answerableTop1Kept: number | null;
    }[];
  };
  perQuery: {
    id: string;
    kind: string;
    query: string;
    top3: ScoredId[];
    reciprocalRank: number | null;
  }[];
}

function metricSet(rows: { ranked: string[]; rel: Relevance }[]): MetricSet {
  return {
    mrr: round(aggregate(rows.map((r) => reciprocalRank(r.ranked, r.rel)))),
    hitAt1: round(aggregate(rows.map((r) => hitAtK(r.ranked, r.rel, 1)))),
    recallAt1: round(aggregate(rows.map((r) => recallAtK(r.ranked, r.rel, 1)))),
    recallAt3: round(aggregate(rows.map((r) => recallAtK(r.ranked, r.rel, 3)))),
    ndcgAt3: round(aggregate(rows.map((r) => ndcgAtK(r.ranked, r.rel, 3)))),
  };
}

export async function evaluateRanker(
  ranker: Ranker,
  queries: GoldenQuery[],
  catalog: CatalogEntry[] = loadCatalog(),
): Promise<RankerResult> {
  let errors = 0;
  const ranked = new Map<string, ScoredId[]>();
  for (const q of queries) {
    try {
      ranked.set(q.id, await ranker.rank(q.query, catalog));
    } catch {
      errors++;
      ranked.set(q.id, []);
    }
  }

  const answerable = queries.filter((q) => q.kind !== "none");
  const none = queries.filter((q) => q.kind === "none");
  const rowOf = (q: GoldenQuery) => ({
    ranked: ranked.get(q.id)!.map((r) => r.datasetId),
    rel: q.relevance,
  });

  const byKind: RankerResult["byKind"] = {};
  for (const kind of new Set(answerable.map((q) => q.kind))) {
    const of = answerable.filter((q) => q.kind === kind);
    byKind[kind] = { n: of.length, ...metricSet(of.map(rowOf)) };
  }

  const falseRate = (threshold: number): number | null =>
    none.length === 0
      ? null
      : round(
          none.filter((q) => topLooksRelevant(ranked.get(q.id)!, threshold))
            .length / none.length,
        );
  const keptRate = (threshold: number): number | null =>
    answerable.length === 0
      ? null
      : round(
          answerable.filter((q) => {
            const top = ranked.get(q.id)![0];
            return (
              top !== undefined &&
              top.score > threshold &&
              (q.relevance[top.datasetId] ?? 0) >= 1
            );
          }).length / answerable.length,
        );

  return {
    ranker: ranker.name,
    description: ranker.description,
    scoreScale: ranker.scoreScale,
    queries: { answerable: answerable.length, noAnswer: none.length },
    errors,
    metrics: metricSet(answerable.map(rowOf)),
    byKind,
    noAnswer: {
      n: none.length,
      falseRelevantRate: falseRate(0),
      curve:
        ranker.scoreScale === "percent"
          ? THRESHOLDS.map((threshold) => ({
              threshold,
              falseRelevantRate: falseRate(threshold),
              answerableTop1Kept: keptRate(threshold),
            }))
          : [],
    },
    perQuery: queries.map((q) => ({
      id: q.id,
      kind: q.kind,
      query: q.query,
      top3: ranked
        .get(q.id)!
        .slice(0, 3)
        .map((r) => ({ datasetId: r.datasetId, score: r.score })),
      reciprocalRank:
        q.kind === "none"
          ? null
          : round(reciprocalRank(rowOf(q).ranked, q.relevance)),
    })),
  };
}

export const overlapRanker: Ranker = {
  name: "overlap_baseline",
  description:
    "Original offline scorer: count of distinct words shared with the listing (copy in retrieval-baseline.ts)",
  scoreScale: "count",
  rank: async (query, catalog) => overlapRank(query, catalog),
};

export const bm25Ranker: Ranker = {
  name: "bm25",
  description:
    "BM25F over title (x3), tags (x2), description (x1), k1 1.2, light plural stemming",
  scoreScale: "percent",
  rank: async (query, catalog) => bm25Rank(query, catalog),
};

export const synonymRanker: Ranker = {
  name: "bm25_synonyms",
  description:
    "BM25 after translating known medical phrases to catalog words (lib/ai/matcher-synonyms.ts)",
  scoreScale: "percent",
  rank: async (query, catalog) => synonymRank(query, catalog),
};

export function claudeRanker(client?: LlmClient): Ranker {
  return {
    name: "claude",
    description: "Claude on Bedrock ranking the whole catalog (no fallback)",
    scoreScale: "percent",
    rank: (query, catalog) => llmMatch(query, catalog, client),
  };
}

export interface RetrievalReport {
  generatedAt: string;
  caveats: string[];
  catalogSize: number;
  golden: {
    path: string;
    queries: number;
    answerable: number;
    noAnswer: number;
  };
  /** The offline matcher flags a match relevant:false at or below this score. */
  minRelevanceThreshold: number;
  rankersRun: string[];
  rankersSkipped: { name: string; reason: string }[];
  /** True only if Claude ranked every golden query with no errors. */
  claudeEvaluated: boolean;
  results: RankerResult[];
  /**
   * Queries written after the synonym map was frozen. Offline rankers only
   * (Claude is not re-run on them).
   */
  heldout: {
    path: string;
    queries: number;
    results: RankerResult[];
  };
}

export interface RunRetrievalOptions {
  env?: Record<string, string | undefined>;
  /** Fake client for tests; defaults to the shared Bedrock client. */
  client?: LlmClient;
  extraRankers?: Ranker[];
}

export async function runRetrieval(
  opts: RunRetrievalOptions = {},
): Promise<RetrievalReport> {
  const env = opts.env ?? process.env;
  const catalog = loadCatalog();
  const { queries } = loadGolden();
  const rankers: Ranker[] = [
    overlapRanker,
    bm25Ranker,
    synonymRanker,
    ...(opts.extraRankers ?? []),
  ];
  const skipped: RetrievalReport["rankersSkipped"] = [];
  const claudeOn = llmEnabled(env);
  if (claudeOn) rankers.push(claudeRanker(opts.client));
  else
    skipped.push({
      name: "claude",
      reason:
        "Claude was not evaluated: LLM_PROVIDER is not bedrock (no Bedrock model access), so no Claude numbers exist in this report.",
    });

  const results: RankerResult[] = [];
  const rankersRun: string[] = [];
  let claudeEvaluated = false;
  for (const ranker of rankers) {
    const r = await evaluateRanker(ranker, queries, catalog);
    results.push(r);
    if (ranker.name === "claude" && r.errors > 0) {
      skipped.push({
        name: "claude",
        reason: `Claude calls failed on ${r.errors} of ${queries.length} queries; its numbers are not valid.`,
      });
    } else {
      rankersRun.push(ranker.name);
      if (ranker.name === "claude") claudeEvaluated = true;
    }
  }

  const held = loadHeldout().queries;
  const heldResults: RankerResult[] = [];
  for (const ranker of rankers.filter((r) => r.name !== "claude"))
    heldResults.push(await evaluateRanker(ranker, held, catalog));

  return {
    generatedAt: new Date().toISOString(),
    caveats: [
      `The catalog holds only ${catalog.length} listings and the relevance labels are the author's own judgment, so these numbers are a regression check, not a benchmark.`,
      "The golden set was written before any ranker was scored on it and its labels have not been edited to raise a score.",
      "The synonym map was written after the first eval showed paraphrase misses, so its gain on the main golden set is in-sample. The held-out set was written after the map was frozen; trust that number more.",
      "Metrics are means over the answerable queries; with this few queries a difference of a few points is noise.",
      "No-answer queries have no relevant listing; falseRelevantRate is how often the top result still has score > 0 (or above a cut-off in the curve).",
    ],
    catalogSize: catalog.length,
    golden: {
      path: "evals/golden/matcher.json",
      queries: queries.length,
      answerable: queries.filter((q) => q.kind !== "none").length,
      noAnswer: queries.filter((q) => q.kind === "none").length,
    },
    minRelevanceThreshold: MIN_KEYWORD_RELEVANCE,
    rankersRun,
    rankersSkipped: skipped,
    claudeEvaluated,
    results,
    heldout: {
      path: "evals/golden/matcher-heldout.json",
      queries: held.length,
      results: heldResults,
    },
  };
}
