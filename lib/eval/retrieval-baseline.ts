// The matcher's original offline scorer, kept verbatim in behaviour as the
// baseline the retrieval eval compares BM25 against: the score is the count of
// distinct words (length >= 3, no filler) shared by the study and a listing.
// Copied from lib/ai/matcher.ts at 02be472. Do not "improve" it; it exists to
// be beaten.
import type { CatalogEntry } from "../ai/matcher";

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

function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3 && !STOP_WORDS.has(t),
  );
}

export function overlapRank(
  studyDescription: string,
  catalog: CatalogEntry[],
): { datasetId: string; score: number }[] {
  const query = new Set(tokens(studyDescription));
  return catalog
    .map((d) => {
      const haystack = new Set(
        tokens(`${d.title} ${d.description} ${d.tags.join(" ")}`),
      );
      return {
        datasetId: d.id,
        score: [...query].filter((t) => haystack.has(t)).length,
      };
    })
    .sort((a, b) => b.score - a.score);
}
