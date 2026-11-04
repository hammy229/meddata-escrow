// Pure survival-analysis helpers: Kaplan-Meier, log-rank, chi-square tail.
// No I/O, no randomness, safe to import from client or server code.

export interface SurvivalObs {
  /** Follow-up time, any non-negative unit. */
  time: number;
  /** True when the event happened, false when censored. */
  event: boolean;
  /** Optional stratum label for a stratified log-rank test. */
  stratum?: string | number;
}

export interface KmStep {
  time: number;
  atRisk: number;
  events: number;
  censored: number;
  survival: number;
}

/** Sort by time, events before censorings at tied times. */
function sortObs(obs: readonly SurvivalObs[]): SurvivalObs[] {
  return [...obs].sort((a, b) => a.time - b.time || Number(b.event) - Number(a.event));
}

/** Kaplan-Meier product-limit curve, one step per distinct observed time. */
export function kaplanMeier(obs: readonly SurvivalObs[]): KmStep[] {
  const sorted = sortObs(obs);
  const steps: KmStep[] = [];
  let atRisk = sorted.length;
  let survival = 1;
  let i = 0;
  while (i < sorted.length) {
    const t = sorted[i].time;
    let events = 0;
    let censored = 0;
    while (i < sorted.length && sorted[i].time === t) {
      if (sorted[i].event) events += 1;
      else censored += 1;
      i += 1;
    }
    survival *= 1 - events / atRisk;
    steps.push({ time: t, atRisk, events, censored, survival });
    atRisk -= events + censored;
  }
  return steps;
}

/** S(t) read off a curve. Returns 1 before the first step. */
export function survivalAt(curve: readonly KmStep[], t: number): number {
  let s = 1;
  for (const step of curve) {
    if (step.time > t) break;
    s = step.survival;
  }
  return s;
}

/** Smallest t with S(t) <= 0.5, or null if the curve never gets there. */
export function medianSurvival(curve: readonly KmStep[]): number | null {
  for (const step of curve) {
    if (step.survival <= 0.5) return step.time;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Chi-square survival function via the regularized incomplete gamma function.

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function logGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const x = z - 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i += 1) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    // Series for P, then Q = 1 - P.
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  // Continued fraction for Q (modified Lentz).
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** P(X >= x) for X ~ chi-square with df degrees of freedom. */
export function chiSquareSf(x: number, df: number): number {
  if (!(df > 0)) throw new RangeError("df must be positive");
  if (!(x > 0)) return 1;
  return Math.min(1, Math.max(0, gammaQ(df / 2, x / 2)));
}

// ---------------------------------------------------------------------------
// Log-rank test.

export interface LogRankResult {
  chiSquare: number;
  df: number;
  pValue: number;
  /** Observed events per input group (same order as the input). */
  observed: number[];
  /** Expected events per input group under the null. */
  expected: number[];
}

/** Solve A x = b by Gaussian elimination with partial pivoting. Null if singular. */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-12) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = col + 1; r < n; r += 1) {
      const f = m[r][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[r][k] -= f * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = m[r][n];
    for (let k = r + 1; k < n; k += 1) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/**
 * Log-rank test across two or more groups. Variance uses the hypergeometric
 * (Mantel-Haenszel) form with the tie correction (n - d) / (n - 1). If any
 * observation carries a stratum, O-E and the covariance are accumulated within
 * each stratum and summed before the test statistic is formed.
 * Empty groups are ignored for the degrees of freedom.
 */
export function logRank(groups: readonly (readonly SurvivalObs[])[]): LogRankResult {
  const k = groups.length;
  const observed = new Array<number>(k).fill(0);
  const expected = new Array<number>(k).fill(0);
  const cov: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));

  const strata = new Map<string, { group: number; time: number; event: boolean }[]>();
  groups.forEach((g, gi) => {
    for (const o of g) {
      const key = String(o.stratum ?? "");
      const list = strata.get(key) ?? [];
      list.push({ group: gi, time: o.time, event: o.event });
      strata.set(key, list);
    }
  });

  for (const rows of strata.values()) {
    const times = [...new Set(rows.filter((r) => r.event).map((r) => r.time))].sort((a, b) => a - b);
    for (const t of times) {
      const n = new Array<number>(k).fill(0);
      const d = new Array<number>(k).fill(0);
      for (const r of rows) {
        if (r.time >= t) n[r.group] += 1;
        if (r.time === t && r.event) d[r.group] += 1;
      }
      const nTot = n.reduce((s, v) => s + v, 0);
      const dTot = d.reduce((s, v) => s + v, 0);
      if (nTot < 1) continue;
      for (let i = 0; i < k; i += 1) {
        observed[i] += d[i];
        expected[i] += (n[i] * dTot) / nTot;
      }
      if (nTot < 2) continue;
      const factor = (dTot * (nTot - dTot)) / (nTot * nTot * (nTot - 1));
      for (let i = 0; i < k; i += 1) {
        for (let j = 0; j < k; j += 1) {
          cov[i][j] += factor * n[i] * ((i === j ? nTot : 0) - n[j]);
        }
      }
    }
  }

  const active = groups.map((g, i) => (g.length > 0 ? i : -1)).filter((i) => i >= 0);
  const df = active.length - 1;
  const none = { chiSquare: 0, df: Math.max(df, 0), pValue: 1, observed, expected };
  if (df < 1) return none;

  const use = active.slice(0, df);
  const diff = use.map((i) => observed[i] - expected[i]);
  const sub = use.map((i) => use.map((j) => cov[i][j]));
  const x = solve(sub, diff);
  if (!x) return none;
  const chiSquare = Math.max(
    0,
    diff.reduce((s, v, i) => s + v * x[i], 0),
  );
  return { chiSquare, df, pValue: chiSquareSf(chiSquare, df), observed, expected };
}
