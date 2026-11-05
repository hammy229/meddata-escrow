// Logistic regression from scratch, no dependency. L2-penalised, fitted by
// Newton steps (IRLS), so the result is deterministic and a perfectly
// separable table does not diverge: the penalty keeps the Hessian invertible
// and the coefficients finite.
//
// Everything learned from data (means, spreads, imputation values, which
// missing indicators exist) comes from the TRAIN rows only. Test rows are only
// ever transformed, never looked at when fitting.
import { rankAuc } from "../fitness/leakage";
import { createRng } from "../synth/prng";

/** A feature cell: a finite number, or null/NaN for missing. */
export type Cell = number | null;

export interface Preprocessor {
  /** Train mean per input column, ignoring missing. */
  means: number[];
  /** Train spread per expanded column (1 when constant). */
  sds: number[];
  /** Train mean per expanded column. */
  centers: number[];
  /** Input columns that got a missing indicator (they had a gap in train). */
  indicatorFor: number[];
}

export interface LogisticModel {
  intercept: number;
  /** One weight per expanded, standardized column. */
  coef: number[];
  prep: Preprocessor;
  iterations: number;
}

export interface FitOptions {
  /** Ridge strength on standardized columns. Default 1. */
  l2?: number;
  maxIter?: number;
}

const isMissing = (v: Cell | undefined): boolean => v === null || v === undefined || Number.isNaN(v);

/** Seeded split that keeps the class mix in both parts. Returns row indexes. */
export function stratifiedSplit(
  labels: readonly number[],
  testFraction: number,
  seed: number,
): { train: number[]; test: number[] } {
  const rng = createRng(seed);
  const train: number[] = [];
  const test: number[] = [];
  for (const cls of [0, 1]) {
    const idx: number[] = [];
    labels.forEach((y, i) => {
      if (y === cls) idx.push(i);
    });
    for (let i = idx.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const nTest = idx.length < 2 ? 0 : Math.min(idx.length - 1, Math.max(1, Math.round(idx.length * testFraction)));
    test.push(...idx.slice(0, nTest));
    train.push(...idx.slice(nTest));
  }
  return { train: train.sort((a, b) => a - b), test: test.sort((a, b) => a - b) };
}

/** Learn imputation and scaling from these rows only. */
export function fitPreprocessor(rows: readonly (readonly Cell[])[]): Preprocessor {
  const p = rows[0]?.length ?? 0;
  const means: number[] = [];
  const indicatorFor: number[] = [];
  for (let c = 0; c < p; c += 1) {
    let sum = 0;
    let n = 0;
    let gaps = 0;
    for (const r of rows) {
      const v = r[c];
      if (isMissing(v)) gaps += 1;
      else {
        sum += v as number;
        n += 1;
      }
    }
    means.push(n > 0 ? sum / n : 0);
    if (gaps > 0) indicatorFor.push(c);
  }
  const expanded = rows.map((r) => expand(r, { means, indicatorFor }));
  const width = p + indicatorFor.length;
  const centers: number[] = [];
  const sds: number[] = [];
  for (let c = 0; c < width; c += 1) {
    let m = 0;
    for (const r of expanded) m += r[c];
    m /= Math.max(1, expanded.length);
    let v = 0;
    for (const r of expanded) v += (r[c] - m) ** 2;
    v /= Math.max(1, expanded.length);
    centers.push(m);
    sds.push(v > 1e-12 ? Math.sqrt(v) : 1);
  }
  return { means, indicatorFor, centers, sds };
}

function expand(row: readonly Cell[], p: Pick<Preprocessor, "means" | "indicatorFor">): number[] {
  const out = row.map((v, c) => (isMissing(v) ? p.means[c] : (v as number)));
  for (const c of p.indicatorFor) out.push(isMissing(row[c]) ? 1 : 0);
  return out;
}

/** Impute with TRAIN means, add TRAIN-decided missing indicators, standardize with TRAIN stats. */
export function transform(prep: Preprocessor, rows: readonly (readonly Cell[])[]): number[][] {
  return rows.map((r) => expand(r, prep).map((v, c) => (v - prep.centers[c]) / prep.sds[c]));
}

const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Solve A x = b in place by Gaussian elimination with partial pivoting. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let i = 0; i < n; i += 1) {
    let piv = i;
    for (let r = i + 1; r < n; r += 1) if (Math.abs(a[r][i]) > Math.abs(a[piv][i])) piv = r;
    [a[i], a[piv]] = [a[piv], a[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    const d = a[i][i] || 1e-12;
    for (let r = i + 1; r < n; r += 1) {
      const f = a[r][i] / d;
      if (f === 0) continue;
      for (let c = i; c < n; c += 1) a[r][c] -= f * a[i][c];
      b[r] -= f * b[i];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = b[i];
    for (let c = i + 1; c < n; c += 1) s -= a[i][c] * x[c];
    x[i] = s / (a[i][i] || 1e-12);
  }
  return x;
}

/**
 * Fit on already standardized columns. The intercept is not penalised.
 * Throws if there are no rows or the lengths disagree.
 */
export function fitStandardized(X: readonly (readonly number[])[], y: readonly number[], opts: FitOptions = {}) {
  if (X.length === 0 || X.length !== y.length) throw new Error("fitStandardized needs matching, non-empty X and y");
  const l2 = opts.l2 ?? 1;
  const maxIter = opts.maxIter ?? 50;
  const p = X[0].length;
  const w = new Array<number>(p + 1).fill(0); // w[0] is the intercept
  let iterations = 0;
  for (let it = 0; it < maxIter; it += 1) {
    iterations = it + 1;
    const g = new Array<number>(p + 1).fill(0);
    const H = Array.from({ length: p + 1 }, () => new Array<number>(p + 1).fill(0));
    for (let i = 0; i < X.length; i += 1) {
      let z = w[0];
      for (let c = 0; c < p; c += 1) z += w[c + 1] * X[i][c];
      const mu = sigmoid(z);
      const s = Math.max(mu * (1 - mu), 1e-9);
      const e = mu - y[i];
      g[0] += e;
      H[0][0] += s;
      for (let c = 0; c < p; c += 1) {
        const xc = X[i][c];
        g[c + 1] += e * xc;
        H[0][c + 1] += s * xc;
        H[c + 1][0] += s * xc;
        for (let d = 0; d <= c; d += 1) {
          const v = s * xc * X[i][d];
          H[c + 1][d + 1] += v;
          if (d !== c) H[d + 1][c + 1] += v;
        }
      }
    }
    for (let c = 1; c <= p; c += 1) {
      g[c] += l2 * w[c];
      H[c][c] += l2;
    }
    const step = solve(H, g);
    let big = 0;
    for (let c = 0; c <= p; c += 1) {
      w[c] -= step[c];
      big = Math.max(big, Math.abs(step[c]));
    }
    if (big < 1e-8) break;
  }
  return { intercept: w[0], coef: w.slice(1), iterations };
}

/** Fit on raw train rows. Preprocessing is learned here, from these rows alone. */
export function fitLogistic(
  rows: readonly (readonly Cell[])[],
  y: readonly number[],
  opts: FitOptions = {},
): LogisticModel {
  const prep = fitPreprocessor(rows);
  const fit = fitStandardized(transform(prep, rows), y, opts);
  return { ...fit, prep };
}

/** Probability of label 1 for raw rows. */
export function predictProba(model: LogisticModel, rows: readonly (readonly Cell[])[]): number[] {
  return transform(model.prep, rows).map((r) => {
    let z = model.intercept;
    for (let c = 0; c < r.length; c += 1) z += model.coef[c] * r[c];
    return sigmoid(z);
  });
}

/** Mean squared gap between probability and outcome. Lower is better; 0.25 is a coin flip at 50/50. */
export function brierScore(p: readonly number[], y: readonly number[]): number {
  if (p.length === 0 || p.length !== y.length) throw new Error("brierScore needs matching, non-empty inputs");
  let s = 0;
  for (let i = 0; i < p.length; i += 1) s += (p[i] - y[i]) ** 2;
  return s / p.length;
}

export interface HoldoutResult {
  auc: number | null;
  brier: number;
  model: LogisticModel;
  trainRows: number;
  testRows: number;
}

/** Stratified split, fit on train, score on test. */
export function holdoutEvaluate(
  rows: readonly (readonly Cell[])[],
  y: readonly number[],
  seed: number,
  opts: FitOptions & { testFraction?: number } = {},
): HoldoutResult {
  const { train, test } = stratifiedSplit(y, opts.testFraction ?? 0.3, seed);
  const model = fitLogistic(
    train.map((i) => rows[i]),
    train.map((i) => y[i]),
    opts,
  );
  const yt = test.map((i) => y[i]);
  const p = predictProba(
    model,
    test.map((i) => rows[i]),
  );
  return { auc: rankAuc(p, yt), brier: brierScore(p, yt), model, trainRows: train.length, testRows: test.length };
}
