// Did the delivery look like the sample the buyer checked? Compares the two
// tables column by column: schema, how much is missing, and the shape of the
// values (population stability index, PSI). Warn only: drift is a reason to
// look, never a reason to hold money. Output is aggregates, never rows.
import { cell, displayCount, isMissing, type Row } from "./common";
import type { Finding } from "./types";

/** Conventional PSI bands: under 0.1 stable, 0.1 to 0.25 moderate, over 0.25 large. */
export const PSI_WARN = 0.1;
export const PSI_LARGE = 0.25;
/** A change in the missing share of at least this many points is reported. */
export const MISSING_SHIFT_PTS = 10;
/** Floor on a bin share so an empty bin does not make the log blow up. */
export const PSI_EPSILON = 1e-4;
export const MIN_DRIFT_ROWS = 30;
const BINS = 10;
const MAX_CATEGORIES = 20;

export interface DriftOptions {
  /** Columns to leave out, e.g. identifiers. Default: none. */
  ignore?: readonly string[];
}

/** PSI between two share vectors over the same bins. Zero shares are floored at epsilon. */
export function psi(
  expected: readonly number[],
  actual: readonly number[],
  epsilon = PSI_EPSILON,
): number {
  let total = 0;
  for (let i = 0; i < expected.length; i += 1) {
    const e = Math.max(expected[i], epsilon);
    const a = Math.max(actual[i], epsilon);
    total += (a - e) * Math.log(a / e);
  }
  return total;
}

function quantileEdges(values: readonly number[], bins: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let i = 1; i < bins; i += 1) {
    const pos = (i / bins) * (sorted.length - 1);
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    const q = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    if (edges.length === 0 || q > edges[edges.length - 1]) edges.push(q);
  }
  return edges;
}

function shares(values: readonly number[], edges: readonly number[]): number[] {
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const v of values) {
    let b = 0;
    while (b < edges.length && v > edges[b]) b += 1;
    counts[b] += 1;
  }
  return counts.map((c) => c / Math.max(1, values.length));
}

/** PSI of a numeric column, with bins cut from the SAMPLE's quantiles. Null if either side has no values. */
export function numericPsi(
  sample: readonly number[],
  delivery: readonly number[],
): number | null {
  if (sample.length === 0 || delivery.length === 0) return null;
  const edges = quantileEdges(sample, BINS);
  return psi(shares(sample, edges), shares(delivery, edges));
}

/** PSI of a categorical column over the union of categories seen on either side. */
export function categoricalPsi(
  sample: readonly string[],
  delivery: readonly string[],
): number | null {
  if (sample.length === 0 || delivery.length === 0) return null;
  const levels = [...new Set([...sample, ...delivery])].sort();
  const share = (v: readonly string[]) =>
    levels.map((l) => v.filter((x) => x === l).length / v.length);
  return psi(share(sample), share(delivery));
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const pct = (x: number) => Math.round(x * 1000) / 10;

function kindOf(values: readonly unknown[]): "numeric" | "categorical" | null {
  if (values.length === 0) return null;
  if (values.every((v) => typeof v === "number" && Number.isFinite(v)))
    return "numeric";
  if (values.every((v) => typeof v === "boolean")) return "numeric";
  if (values.every((v) => typeof v === "string")) return "categorical";
  return null;
}

/** Compare the sample the buyer checked with the delivered rows. */
export function checkDrift(
  sample: readonly Row[],
  delivery: readonly Row[],
  opts: DriftOptions = {},
): Finding[] {
  if (sample.length < MIN_DRIFT_ROWS || delivery.length < MIN_DRIFT_ROWS) {
    return [
      {
        id: "drift",
        severity: "info",
        title: "Drift not measured",
        reason: `Drift needs at least ${MIN_DRIFT_ROWS} rows on each side; the sample has ${displayCount(sample.length)} and the delivery has ${displayCount(delivery.length)}.`,
      },
    ];
  }
  const ignore = new Set(opts.ignore ?? []);
  const sampleCols = Object.keys(sample[0]).filter((c) => !ignore.has(c));
  const deliveryCols = Object.keys(delivery[0]).filter((c) => !ignore.has(c));
  const findings: Finding[] = [];

  for (const c of deliveryCols.filter((x) => !sampleCols.includes(x))) {
    findings.push({
      id: "drift",
      severity: "warn",
      column: c,
      title: `${c} was added after the sample`,
      reason: `The delivered rows have a ${c} column that the sample did not have.`,
      metric: { change: "added" },
    });
  }
  for (const c of sampleCols.filter((x) => !deliveryCols.includes(x))) {
    findings.push({
      id: "drift",
      severity: "warn",
      column: c,
      title: `${c} was removed after the sample`,
      reason: `The sample had a ${c} column that the delivered rows do not have.`,
      metric: { change: "removed" },
    });
  }

  for (const c of sampleCols.filter((x) => deliveryCols.includes(x))) {
    const sv = sample.map((r) => cell(r, c));
    const dv = delivery.map((r) => cell(r, c));
    const sMissing = sv.filter(isMissing).length / sv.length;
    const dMissing = dv.filter(isMissing).length / dv.length;
    const shift = Math.abs(dMissing - sMissing) * 100;
    if (shift >= MISSING_SHIFT_PTS) {
      findings.push({
        id: "drift",
        severity: "warn",
        column: c,
        title: `${c} missingness changed from ${pct(sMissing)}% to ${pct(dMissing)}%`,
        reason: `${pct(sMissing)}% of the sample had no ${c}; ${pct(dMissing)}% of the delivered rows have none.`,
        metric: {
          sampleMissingPct: pct(sMissing),
          deliveryMissingPct: pct(dMissing),
        },
      });
    }

    const sp = sv.filter((v) => !isMissing(v));
    const dp = dv.filter((v) => !isMissing(v));
    const kind = kindOf(sp);
    if (kind === null || kindOf(dp) !== kind) continue;
    let value: number | null;
    if (kind === "numeric") value = numericPsi(sp.map(Number), dp.map(Number));
    else {
      const levels = new Set([...sp, ...dp] as string[]);
      if (levels.size > MAX_CATEGORIES) continue;
      value = categoricalPsi(sp as string[], dp as string[]);
    }
    if (value === null || value < PSI_WARN) continue;
    const large = value >= PSI_LARGE;
    findings.push({
      id: "drift",
      severity: "warn",
      column: c,
      title: `${c} ${large ? "shifted a lot" : "shifted"} between sample and delivery`,
      reason: `PSI of ${c} is ${r3(value)} (${large ? `large, over ${PSI_LARGE}` : `moderate, ${PSI_WARN} to ${PSI_LARGE}`}). The delivered values are spread differently from the sample.`,
      metric: { psi: r3(value), kind },
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "drift",
      severity: "pass",
      title: "Delivery looks like the sample",
      reason: `Columns, missing shares and value spreads match the sample (PSI under ${PSI_WARN}, missing share within ${MISSING_SHIFT_PTS} points).`,
    });
  }
  return findings;
}
