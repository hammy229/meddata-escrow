// Pure helpers for drawing survival curves. No React, no I/O, safe in a client
// bundle. The chart itself lives in app/components/SurvivalChart.tsx.

/** Listings whose rows are a SYNTHETIC ALS fixture (the only ones that answer a survival request). */
export function supportsSurvival(datasetId: string): boolean {
  return datasetId.startsWith("ds_als_");
}

export interface XY {
  month: number;
  survival: number;
}

/** SVG path for a step curve: hold the level, then drop at the next point. */
export function stepPath(
  points: readonly XY[],
  x: (month: number) => number,
  y: (survival: number) => number,
): string {
  if (points.length === 0) return "";
  const r = (n: number) => Math.round(n * 10) / 10;
  let d = `M${r(x(points[0].month))} ${r(y(points[0].survival))}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` H${r(x(points[i].month))} V${r(y(points[i].survival))}`;
  }
  return d;
}

/**
 * Move direct labels apart so they never overlap: each label sits at least
 * `gap` below the one above it, and the stack is pulled back inside
 * [min, max]. Returns positions in the input order.
 */
export function spreadLabels(
  ys: readonly number[],
  gap: number,
  min: number,
  max: number,
): number[] {
  const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b] || a - b);
  const out = new Array<number>(ys.length).fill(0);
  let prev = -Infinity;
  for (const i of order) {
    prev = Math.max(ys[i], prev + gap, min);
    out[i] = prev;
  }
  const overflow = (order.length ? out[order[order.length - 1]] : 0) - max;
  if (overflow > 0) {
    let next = Infinity;
    for (const i of [...order].reverse()) {
      next = Math.min(out[i] - overflow, next - gap);
      out[i] = Math.max(next, min);
      next = out[i];
    }
  }
  return out;
}

/** "below 0.001", "0.326", or "not available". */
export function formatP(p: number | null | undefined): string {
  if (p === null || p === undefined || Number.isNaN(p)) return "not available";
  return p < 0.001 ? "below 0.001" : p.toFixed(3);
}

/** Dash patterns, one per group, so colour is never the only signal. */
export const DASHES: readonly (string | undefined)[] = [
  undefined,
  "7 4",
  "2 3",
  "10 3 2 3",
  "4 2 1 2",
];

export type MarkerShape =
  "circle" | "square" | "triangle" | "diamond" | "cross";
export const MARKERS: readonly MarkerShape[] = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
];

export function dashFor(i: number): string | undefined {
  return DASHES[i % DASHES.length];
}
export function markerFor(i: number): MarkerShape {
  return MARKERS[i % MARKERS.length];
}

const GROUP_BY_LABEL: Record<string, string> = {
  arm: "arm",
  sex: "sex",
  onset_site: "onset site",
  age_band: "age band",
};
export function groupByLabel(groupBy: string): string {
  return GROUP_BY_LABEL[groupBy] ?? groupBy.replace(/_/g, " ");
}

/** "Arm A", "female", "60-69" -> a short readable group name. */
export function groupLabel(groupBy: string, group: string): string {
  if (groupBy === "arm") return `Arm ${group}`;
  if (groupBy === "age_band") return `Age ${group}`;
  if (groupBy === "sex")
    return group === "F" ? "Female" : group === "M" ? "Male" : group;
  return group.charAt(0).toUpperCase() + group.slice(1);
}
