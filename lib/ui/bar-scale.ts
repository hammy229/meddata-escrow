// Inline bars for grouped query results. Pure sizing rules, so the zero,
// negative and suppressed-cell cases are tested apart from the grid renderer.

export interface Bar {
  /** Width as a percentage of the cell, 0 to 100. */
  pct: number;
  negative: boolean;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * The size every bar in a column is measured against: the largest absolute
 * value. Anything that is not a finite number (a suppressed cell, a null)
 * is skipped.
 */
export function barMax(values: unknown[]): number {
  let max = 0;
  for (const v of values) {
    if (isFiniteNumber(v)) max = Math.max(max, Math.abs(v));
  }
  return max;
}

/**
 * Bar for one cell, or null when there is nothing to draw: a suppressed or
 * missing value, or a column whose values are all zero. Negatives draw at
 * their magnitude and are flagged so the renderer can style them.
 */
export function barFor(value: unknown, max: number): Bar | null {
  if (!isFiniteNumber(value) || !(max > 0)) return null;
  const pct = Math.min(100, (Math.abs(value) / max) * 100);
  return { pct, negative: value < 0 };
}
