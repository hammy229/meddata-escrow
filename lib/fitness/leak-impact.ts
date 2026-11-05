// How much does a flagged column inflate a model? The other screens say a
// column looks like a leak. This one trains a small model twice on the rows it
// was given, with and without the flagged columns, and reports held-out AUC for
// both. The gap is the evidence. It is information only: it never changes the
// verdict and never blocks money.
//
// Target: death by month `horizon`. A subject counts as a case if they died by
// the horizon, and as a non-case if they were followed past it. Subjects
// censored before the horizon are left out, because their status at the
// horizon is unknown. Output is aggregates only, never rows.
import { rankAuc } from "./leakage";
import { cell, displayCount, isMissing, type Row } from "./common";
import {
  fitLogistic,
  predictProba,
  stratifiedFolds,
  type Cell,
} from "../stats/logistic";
import type { Finding } from "./types";

export const MIN_CASES = 20;
export const MIN_NON_CASES = 20;
/** A gap below this is reported as "adds little" rather than as a leak. */
export const LEAK_GAP = 0.05;
const MAX_LEVELS = 8;

export interface LeakImpactInput {
  subjects: readonly Row[];
  label: string;
  timeColumn: string;
  /** Columns the model may use. */
  features: readonly string[];
  /** Columns flagged by the temporal or association screens. */
  flagged: readonly string[];
  horizonMonths?: number;
  seed?: number;
  folds?: number;
  repeats?: number;
}

export interface LeakImpact {
  aucWith: number;
  aucWithout: number;
  gap: number;
  gapFoldLow: number;
  gapFoldHigh: number;
  cases: number;
  nonCases: number;
  censoredDropped: number;
  folds: number;
  repeats: number;
}

type Skipped = {
  skipped: string;
  cases: number;
  nonCases: number;
  censoredDropped: number;
};

const round2 = (x: number) => Math.round(x * 100) / 100;

function percentile(sorted: readonly number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Turn chosen columns into numeric cells: numbers as they are, text as one-hot when it has few levels. */
function design(rows: readonly Row[], columns: readonly string[]): Cell[][] {
  const parts: ((r: Row) => Cell)[] = [];
  for (const c of columns) {
    const vals = rows.map((r) => cell(r, c)).filter((v) => !isMissing(v));
    if (vals.length === 0) continue;
    if (vals.every((v) => typeof v === "number" || typeof v === "boolean")) {
      parts.push((r) => {
        const v = cell(r, c);
        return isMissing(v) ? null : Number(v);
      });
    } else if (vals.every((v) => typeof v === "string")) {
      const levels = [...new Set(vals as string[])].sort();
      if (levels.length > MAX_LEVELS) continue;
      for (const level of levels.slice(1))
        parts.push((r) =>
          isMissing(cell(r, c)) ? null : cell(r, c) === level ? 1 : 0,
        );
    }
  }
  return rows.map((r) => parts.map((p) => p(r)));
}

/** Train with and without the flagged columns on the same folds. Null-safe: returns a skip reason when it cannot run. */
export function measureLeakImpact(
  input: LeakImpactInput,
): LeakImpact | Skipped {
  const horizon = input.horizonMonths ?? 12;
  const k = input.folds ?? 5;
  const repeats = input.repeats ?? 4;
  const seed = input.seed ?? 7;

  const used: Row[] = [];
  const y: number[] = [];
  let censoredDropped = 0;
  for (const r of input.subjects) {
    const t = Number(cell(r, input.timeColumn));
    const d = Number(cell(r, input.label));
    if (!Number.isFinite(t) || (d !== 0 && d !== 1)) continue;
    if (d === 1 && t <= horizon) {
      used.push(r);
      y.push(1);
    } else if (t > horizon) {
      used.push(r);
      y.push(0);
    } else censoredDropped += 1;
  }
  const cases = y.filter((v) => v === 1).length;
  const nonCases = y.length - cases;
  const meta = { cases, nonCases, censoredDropped };
  if (cases < MIN_CASES || nonCases < MIN_NON_CASES)
    return {
      ...meta,
      skipped: `Too few subjects to compare models: ${displayCount(cases)} died by month ${horizon} and ${displayCount(nonCases)} were followed past it (need ${MIN_CASES} of each).`,
    };

  const withCols = input.features;
  const withoutCols = input.features.filter((c) => !input.flagged.includes(c));
  const Xwith = design(used, withCols);
  const Xwithout = design(used, withoutCols);
  if (Xwithout[0].length === 0)
    return {
      ...meta,
      skipped:
        "Nothing is left to train on once the flagged columns are removed.",
    };

  const aw: number[] = [];
  const ao: number[] = [];
  const diff: number[] = [];
  for (let rep = 0; rep < repeats; rep += 1) {
    const folds = stratifiedFolds(y, k, seed + rep);
    for (const held of folds) {
      const heldSet = new Set(held);
      const train = y.map((_, i) => i).filter((i) => !heldSet.has(i));
      const yt = held.map((i) => y[i]);
      const score = (X: Cell[][]) => {
        const m = fitLogistic(
          train.map((i) => X[i]),
          train.map((i) => y[i]),
        );
        return rankAuc(
          predictProba(
            m,
            held.map((i) => X[i]),
          ),
          yt,
        );
      };
      const a = score(Xwith);
      const b = score(Xwithout);
      if (a === null || b === null) continue;
      aw.push(a);
      ao.push(b);
      diff.push(a - b);
    }
  }
  if (diff.length === 0)
    return { ...meta, skipped: "No held-out fold had both outcomes." };
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const sorted = [...diff].sort((a, b) => a - b);
  return {
    aucWith: mean(aw),
    aucWithout: mean(ao),
    gap: mean(diff),
    gapFoldLow: percentile(sorted, 0.025),
    gapFoldHigh: percentile(sorted, 0.975),
    ...meta,
    folds: k,
    repeats,
  };
}

/** The leak_impact finding, or null when nothing was flagged. */
export function checkLeakImpact(input: LeakImpactInput): Finding | null {
  const flagged = [...new Set(input.flagged)];
  if (flagged.length === 0) return null;
  const horizon = input.horizonMonths ?? 12;
  const list = flagged.join(", ");
  const r = measureLeakImpact({ ...input, flagged });
  if ("skipped" in r) {
    return {
      id: "leak_impact",
      severity: "info",
      title: "Leak size not measured",
      reason: `${r.skipped} The flagged columns (${list}) were not compared.`,
      metric: {
        cases: displayCount(r.cases),
        nonCases: displayCount(r.nonCases),
      },
    };
  }
  const w = round2(r.aucWith);
  const wo = round2(r.aucWithout);
  const gap = round2(r.gap);
  const how =
    `Target: death by month ${horizon}; ${displayCount(r.censoredDropped)} subjects censored before month ${horizon} are left out, which can bias the comparison if they differ from the rest. ` +
    `The flag itself comes from screens that use the outcome at any time, while this model uses death by month ${horizon}. ` +
    `Scores are held-out AUC, ${r.folds}-fold cross-validation repeated ${r.repeats} times. ` +
    `The spread is the range across folds that share rows, so it is not a confidence interval.`;
  const range = `${round2(r.gapFoldLow)} to ${round2(r.gapFoldHigh)}`;
  const leaky = r.gap >= LEAK_GAP;
  const reason = leaky
    ? `With ${list} a model scores AUC ${w} on held-out rows. Without it, ${wo}. The extra ${gap} (spread across folds ${range}) is a larger lift than ordinary signal usually gives. Check whether ${list} is known at the time a prediction is made. A strong legitimate predictor can also lift a model. ${how}`
    : `With ${list} a model scores AUC ${w} on held-out rows. Without it, ${wo}. The flagged column adds only ${gap} (spread across folds ${range}) here. ${how}`;
  return {
    id: "leak_impact",
    severity: "info",
    ...(flagged.length === 1 ? { column: flagged[0] } : {}),
    title: leaky
      ? `${list} lifts a model from AUC ${wo} to ${w}`
      : `${list} adds little to a model (AUC ${wo} to ${w})`,
    reason,
    metric: {
      aucWith: w,
      aucWithout: wo,
      gap,
      gapFoldLow: round2(r.gapFoldLow),
      gapFoldHigh: round2(r.gapFoldHigh),
      cases: displayCount(r.cases),
      nonCases: displayCount(r.nonCases),
      censoredDropped: displayCount(r.censoredDropped),
    },
  };
}
