// Keyword-only guess at which schema columns a study needs. No model call.
// A column is needed when a distinctive word from its name, or one of a few
// plain-language aliases, appears in the study text.

export interface Needs {
  needed: string[];
  notNeeded: string[];
}

// Words that say nothing about what a column measures.
const GENERIC = new Set([
  "pct", "total", "at", "key", "months", "month", "baseline", "visit", "id", "of", "the", "score", "value", "subject",
]);

// Everyday phrases for a column word. Matched as substrings of the lowercased study.
const ALIASES: Record<string, string[]> = {
  fvc: ["forced vital capacity", "vital capacity"],
  alsfrs: ["functional rating", "als function"],
  died: ["death", "mortality", "survival", "survive"],
  survival: ["time to death", "time-to-event", "time to event", "lifespan"],
  onset: ["bulbar", "spinal"],
  arm: ["treatment group", "randomi"],
};

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

export function deriveNeeds(study: string, schema: readonly string[]): Needs {
  const text = (study ?? "").toLowerCase();
  const words = new Set<string>();
  for (const w of text.match(/[a-z0-9]+/g) ?? []) {
    words.add(w);
    words.add(stem(w));
  }
  const needed: string[] = [];
  const notNeeded: string[] = [];
  for (const column of schema) {
    const parts = column
      .toLowerCase()
      .split("_")
      .filter((p) => p && !GENERIC.has(p));
    const hit = parts.some(
      (p) => words.has(p) || words.has(stem(p)) || (ALIASES[p] ?? []).some((phrase) => text.includes(phrase)),
    );
    (hit ? needed : notNeeded).push(column);
  }
  return { needed, notNeeded };
}
