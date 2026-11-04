// Seeded random numbers for synthetic data. Same seed, same stream, on every
// machine. Nothing in lib/synth may call Math.random.

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [lo, hi] inclusive. */
  int(lo: number, hi: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Normal draw (Box-Muller). */
  normal(mean?: number, sd?: number): number;
  /** Exponential draw with the given rate. */
  exponential(rate: number): number;
}

/** mulberry32: small 32-bit generator with a single integer of state. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRng(seed: number): Rng {
  const raw = mulberry32(seed);
  const next = () => raw();
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    normal: (mean = 0, sd = 1) => {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    exponential: (rate) => -Math.log(1 - next()) / rate,
  };
}
