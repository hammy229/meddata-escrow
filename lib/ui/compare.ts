// Side-by-side comparison of ranked matches (researcher step 2). Pure helpers
// so the "which cell wins" rules are tested apart from the grid and table.

/** Most matches that can be compared at once; a fourth column stops fitting. */
export const MAX_COMPARE = 3;

export interface Comparable {
  datasetId: string;
  title: string;
  score: number;
  rationale: string;
  priceCents: number;
  recordCount?: number;
}

/**
 * Add or remove a dataset id from the compare list. A new id is ignored once
 * the list is full, so the first three picks stay put.
 */
export function toggleCompare(ids: string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((x) => x !== id);
  return ids.length >= MAX_COMPARE ? ids : [...ids, id];
}

/**
 * Keep the earlier picks in their order, add new ones after them, and drop
 * anything past the cap. `current` is what the grid reports as selected.
 */
export function reconcileCompare(
  previous: string[],
  current: string[],
): string[] {
  const kept = previous.filter((id) => current.includes(id));
  const added = current.filter((id) => !previous.includes(id));
  return [...kept, ...added].slice(0, MAX_COMPARE);
}

/**
 * Flag the best value in a row. Missing values never win, and a row where every
 * known value is equal (or only one is known) flags nothing, so a tie does not
 * paint the whole row.
 */
export function bestFlags(
  values: (number | null | undefined)[],
  prefer: "low" | "high",
): boolean[] {
  const known = values.filter((v): v is number => typeof v === "number");
  if (known.length < 2) return values.map(() => false);
  const best = prefer === "low" ? Math.min(...known) : Math.max(...known);
  if (known.every((v) => v === best)) return values.map(() => false);
  return values.map((v) => v === best);
}

export interface CompareCell {
  text: string;
  best: boolean;
}

export interface CompareRow {
  key: "price" | "records" | "fit" | "why";
  label: string;
  cells: CompareCell[];
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Build the table rows for the picked matches, at most MAX_COMPARE of them. */
export function compareRows(picks: Comparable[]): CompareRow[] {
  const shown = picks.slice(0, MAX_COMPARE);
  const price = bestFlags(
    shown.map((m) => m.priceCents),
    "low",
  );
  const records = bestFlags(
    shown.map((m) => m.recordCount),
    "high",
  );
  const fit = bestFlags(
    shown.map((m) => m.score),
    "high",
  );
  return [
    {
      key: "price",
      label: "Price",
      cells: shown.map((m, i) => ({ text: usd(m.priceCents), best: price[i] })),
    },
    {
      key: "records",
      label: "Records",
      cells: shown.map((m, i) => ({
        text:
          typeof m.recordCount === "number"
            ? m.recordCount.toLocaleString("en-US")
            : "Not listed",
        best: records[i],
      })),
    },
    {
      key: "fit",
      label: "Fit score",
      cells: shown.map((m, i) => ({ text: String(m.score), best: fit[i] })),
    },
    {
      key: "why",
      label: "Why it matched",
      cells: shown.map((m) => ({ text: m.rationale, best: false })),
    },
  ];
}
