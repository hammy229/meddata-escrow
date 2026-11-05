// Small statistics helpers for the evals. No dependency.

export interface Proportion {
  k: number;
  n: number;
  rate: number;
  lo: number;
  hi: number;
}

/** Wilson score interval for k successes in n trials. z = 1.96 gives 95%. Safe at k = 0 and k = n. */
export function wilson(k: number, n: number, z = 1.96): Proportion {
  if (!Number.isInteger(k) || !Number.isInteger(n) || n < 0 || k < 0 || k > n) {
    throw new Error(`wilson needs integers with 0 <= k <= n, got ${k}/${n}`);
  }
  if (n === 0) return { k, n, rate: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    k,
    n,
    rate: p,
    lo: Math.max(0, centre - half),
    hi: Math.min(1, centre + half),
  };
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 on erf, error under 1.5e-7). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + (0.3275911 * Math.abs(x)) / Math.SQRT2);
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp((-x * x) / 2);
  return 0.5 * (1 + (x < 0 ? -erf : erf));
}

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, v) => s + v, 0) / xs.length;
}

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Round to a fixed number of decimals, for stable committed output. */
export function round(x: number, digits = 4): number {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}
