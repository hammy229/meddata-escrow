// Ranking metrics for the retrieval eval. A listing is "relevant" when its
// graded label is 1 or 2; a label of 0 or a missing label means not relevant.
// Pure functions, no I/O.

export type Relevance = Record<string, number>;

function isRelevant(rel: Relevance, id: string): boolean {
  return (rel[id] ?? 0) >= 1;
}

function relevantCount(rel: Relevance): number {
  return Object.values(rel).filter((g) => g >= 1).length;
}

/** 1 / rank of the first relevant result; 0 when none is found. */
export function reciprocalRank(ranked: string[], rel: Relevance): number {
  const i = ranked.findIndex((id) => isRelevant(rel, id));
  return i === -1 ? 0 : 1 / (i + 1);
}

/** Share of relevant listings in the top k. null when nothing is relevant. */
export function recallAtK(
  ranked: string[],
  rel: Relevance,
  k: number,
): number | null {
  const total = relevantCount(rel);
  if (total === 0) return null;
  const found = ranked.slice(0, k).filter((id) => isRelevant(rel, id)).length;
  return found / total;
}

/** 1 when any relevant listing is in the top k, else 0. */
export function hitAtK(ranked: string[], rel: Relevance, k: number): number {
  return ranked.slice(0, k).some((id) => isRelevant(rel, id)) ? 1 : 0;
}

function dcg(grades: number[]): number {
  return grades.reduce((acc, g, i) => acc + (2 ** g - 1) / Math.log2(i + 2), 0);
}

/** nDCG@k with gain 2^grade - 1. null when nothing is relevant. */
export function ndcgAtK(
  ranked: string[],
  rel: Relevance,
  k: number,
): number | null {
  if (relevantCount(rel) === 0) return null;
  const got = dcg(ranked.slice(0, k).map((id) => rel[id] ?? 0));
  const ideal = dcg(
    Object.values(rel)
      .sort((a, b) => b - a)
      .slice(0, k),
  );
  return got / ideal;
}

/**
 * For a question with no answer in the catalog: does the top result's score
 * clear `threshold` (strictly above), so a caller would present it as a match?
 */
export function topLooksRelevant(
  ranked: { datasetId: string; score: number }[],
  threshold: number,
): boolean {
  return ranked.length > 0 && ranked[0].score > threshold;
}

/** Mean of the non-null values; null when there are none. */
export function aggregate(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}
