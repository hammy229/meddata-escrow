// Offline dataset ranking: BM25F over title, tags and description.
//
// Why not word overlap: counting shared words treats "the" and "synthetic"
// (in every listing) like "asthma", and rewards long descriptions. BM25 weighs
// each query term by how rare it is across the catalog, saturates repeats, and
// normalizes for field length. Fields are combined before saturation (BM25F),
// so a title hit counts more than a description hit.
//
// The parameters are the textbook defaults (k1 1.2, b 0.75 on the description) with field weights
// set by reasoning, not fitted: title 3, tags 2, description 1. They were
// fixed before the golden set in evals/golden was scored; do not tune them to
// it (nine listings is far too few to tune on).
//
// Score: the BM25 sum as a percentage of its ceiling for this query, which is
// (k1 + 1) times the sum of the query terms' idf (what a term repeated without
// limit would earn). So it is comparable across queries, which a minimum-
// relevance cut-off needs, and it stays inside the 0 to 100 range the LLM
// ranker also uses. Words the catalog has never seen count in the ceiling, so
// a study that is mostly off-catalog words scores low everywhere instead of
// the one matching word looking like a full hit. Nothing is clamped, so
// listings that match the same terms still rank by how well they match.
import type { CatalogEntry, DatasetMatch } from "./matcher";

export interface Bm25Options {
  k1: number;
  weights: { title: number; tags: number; description: number };
  /**
   * Length normalization per field. Only prose is normalized: a title or a
   * tag list is short by design, and a longer list of tags is not a weaker
   * match.
   */
  fieldB: { title: number; tags: number; description: number };
}

export const DEFAULT_BM25: Bm25Options = {
  k1: 1.2,
  weights: { title: 3, tags: 2, description: 1 },
  fieldB: { title: 0, tags: 0, description: 0.75 },
};

// Common English filler that appears in both studies and dataset blurbs.
const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "have",
  "into",
  "its",
  "not",
  "our",
  "that",
  "the",
  "their",
  "this",
  "was",
  "were",
  "what",
  "which",
  "who",
  "will",
  "with",
  "you",
  "your",
]);

/** Light plural folding: inhalers -> inhaler, studies -> study, boxes -> box. */
export function stem(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (/(?:ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word))
    return word.slice(0, -1);
  return word;
}

/** Stemmed lowercase terms of length >= 3, minus filler words. */
export function searchTerms(text: string): string[] {
  return rawWords(text).map(stem);
}

function rawWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3 && !STOP_WORDS.has(t),
  );
}

function counts(terms: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const t of terms) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}

const FIELDS = ["title", "tags", "description"] as const;

/**
 * Rank the whole catalog for a study description, best first. Ties keep
 * catalog order. Always returns one match per listing.
 */
export function bm25Rank(
  query: string,
  catalog: CatalogEntry[],
  opts: Bm25Options = DEFAULT_BM25,
): DatasetMatch[] {
  const surface = new Map<string, string>(); // stem -> first word that produced it
  for (const w of rawWords(query)) {
    const s = stem(w);
    if (!surface.has(s)) surface.set(s, w);
  }
  const queryTerms = [...surface.keys()];

  const docs = catalog.map((d) => {
    const fields = {
      title: counts(searchTerms(d.title)),
      tags: counts(searchTerms(d.tags.join(" "))),
      description: counts(searchTerms(d.description)),
    };
    const lengths = {
      title: sum(fields.title),
      tags: sum(fields.tags),
      description: sum(fields.description),
    };
    return { fields, lengths };
  });
  const n = catalog.length;
  const avg = Object.fromEntries(
    FIELDS.map((f) => [
      f,
      n ? docs.reduce((acc, d) => acc + d.lengths[f], 0) / n : 0,
    ]),
  ) as Record<(typeof FIELDS)[number], number>;

  const idf = new Map<string, number>();
  for (const t of queryTerms) {
    const df = docs.filter((d) =>
      FIELDS.some((f) => d.fields[f].has(t)),
    ).length;
    idf.set(t, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
  }
  const ceiling =
    (opts.k1 + 1) * queryTerms.reduce((acc, t) => acc + idf.get(t)!, 0);

  return catalog
    .map((entry, i): DatasetMatch => {
      const { fields, lengths } = docs[i];
      let raw = 0;
      const matched: string[] = [];
      for (const t of queryTerms) {
        let tf = 0;
        for (const f of FIELDS) {
          const count = fields[f].get(t) ?? 0;
          if (count === 0) continue;
          const b = opts.fieldB[f];
          const norm = 1 - b + (b * lengths[f]) / (avg[f] || 1);
          tf += (opts.weights[f] * count) / norm;
        }
        if (tf === 0) continue;
        matched.push(surface.get(t)!);
        raw += (idf.get(t)! * tf * (opts.k1 + 1)) / (opts.k1 + tf);
      }
      const score = ceiling > 0 ? (100 * raw) / ceiling : 0;
      return {
        datasetId: entry.id,
        score: Math.round(score * 10) / 10,
        rationale: matched.length
          ? `Matched on: ${matched.join(", ")}`
          : "No direct keyword overlap",
        source: "keyword",
      };
    })
    .sort((a, b) => b.score - a.score);
}

function sum(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}
