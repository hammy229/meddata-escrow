import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chiSquareSf,
  kaplanMeier,
  logRank,
  medianSurvival,
  survivalAt,
  type SurvivalObs,
} from "./survival";

const obs = (time: number, event = true, stratum?: string): SurvivalObs => ({ time, event, stratum });

// Freireich leukemia remission data (Gehan 1965), 21 subjects per arm.
// "c" marks a censored time.
const SIX_MP: SurvivalObs[] = [
  6, 6, 6, "6c", 7, "9c", 10, "10c", "11c", 13, 16, "17c", "19c", "20c", 22, 23, "25c", "32c", "32c", "34c", "35c",
].map((v) => (typeof v === "string" ? obs(Number.parseInt(v, 10), false) : obs(v)));

const PLACEBO: SurvivalObs[] = [1, 1, 2, 2, 3, 4, 4, 5, 5, 8, 8, 8, 8, 11, 11, 12, 12, 15, 17, 22, 23].map((t) =>
  obs(t),
);

describe("kaplanMeier", () => {
  // Hand working, 6-MP arm (n = 21):
  //  t=6 : 21 at risk, 3 events (one censoring at 6 stays in the risk set) -> 18/21 = .857
  //  t=7 : 17 at risk, 1 event -> .857 * 16/17 = .807
  //  t=10: 15 at risk (9 censored), 1 event -> .807 * 14/15 = .753
  //  t=13: 12 at risk (10 and 11 censored), 1 event -> .753 * 11/12 = .690
  //  t=16: 11 at risk, 1 event -> .690 * 10/11 = .627
  //  t=22: 7 at risk (17, 19, 20 censored), 1 event -> .627 * 6/7 = .538
  //  t=23: 6 at risk, 1 event -> .538 * 5/6 = .448
  it("matches the hand-worked 6-MP curve", () => {
    const curve = kaplanMeier(SIX_MP);
    const expected: [number, number][] = [
      [6, 0.857],
      [7, 0.807],
      [10, 0.753],
      [13, 0.69],
      [16, 0.627],
      [22, 0.538],
      [23, 0.448],
    ];
    for (const [t, s] of expected) {
      assert.ok(Math.abs(survivalAt(curve, t) - s) < 0.0006, `S(${t}) = ${survivalAt(curve, t)}`);
    }
  });

  it("counts events before censorings at tied times", () => {
    const curve = kaplanMeier(SIX_MP);
    const first = curve[0];
    assert.equal(first.time, 6);
    assert.equal(first.atRisk, 21);
    assert.equal(first.events, 3);
    assert.equal(first.censored, 1);
    // Input order must not matter.
    const shuffled = kaplanMeier([...SIX_MP].reverse());
    assert.deepEqual(shuffled, curve);
  });

  it("computes medians: 23 for 6-MP, 8 for placebo", () => {
    // Placebo: S(5) = 12/21 = .571, S(8) = 8/21 = .381 -> first t with S <= .5 is 8.
    // 6-MP: S(22) = .538 > .5, S(23) = .448 -> 23.
    assert.equal(medianSurvival(kaplanMeier(SIX_MP)), 23);
    assert.equal(medianSurvival(kaplanMeier(PLACEBO)), 8);
  });

  it("returns a median of exactly the time where S hits 0.5", () => {
    assert.equal(medianSurvival(kaplanMeier([obs(1), obs(2), obs(3), obs(4)])), 2);
  });

  it("returns null median when the curve stays above 0.5", () => {
    assert.equal(medianSurvival(kaplanMeier([obs(1), obs(5, false), obs(6, false), obs(7, false)])), null);
  });

  it("handles empty and all-censored groups", () => {
    assert.deepEqual(kaplanMeier([]), []);
    assert.equal(medianSurvival([]), null);
    const censored = kaplanMeier([obs(2, false), obs(5, false)]);
    assert.equal(survivalAt(censored, 10), 1);
    assert.equal(medianSurvival(censored), null);
    assert.equal(survivalAt([], 3), 1);
  });
});

describe("chiSquareSf", () => {
  it("has p = .05 at the textbook critical values", () => {
    assert.ok(Math.abs(chiSquareSf(3.841, 1) - 0.05) < 1e-4);
    assert.ok(Math.abs(chiSquareSf(5.991, 2) - 0.05) < 1e-4);
  });

  it("matches the closed form exp(-x/2) for 2 df", () => {
    for (const x of [0.1, 1, 4.5, 12, 30]) {
      assert.ok(Math.abs(chiSquareSf(x, 2) - Math.exp(-x / 2)) < 1e-12);
    }
  });

  it("returns 1 at or below zero and rejects bad df", () => {
    assert.equal(chiSquareSf(0, 1), 1);
    assert.equal(chiSquareSf(-3, 4), 1);
    assert.throws(() => chiSquareSf(1, 0), RangeError);
  });
});

describe("logRank", () => {
  // Hand working, 6-MP vs placebo. For each distinct event time,
  // E(6-MP) = n6 * d / N and V = n6 * np * d * (N - d) / (N^2 * (N - 1)).
  //   t   n6  np  d  d6   E      V
  //   1   21  21  2  0  1.000  0.488
  //   2   21  19  2  0  1.050  0.486
  //   3   21  17  1  0  0.553  0.247
  //   4   21  16  2  0  1.135  0.477
  //   5   21  14  2  0  1.200  0.466
  //   6   21  12  3  3  1.909  0.651
  //   7   17  12  1  1  0.586  0.243
  //   8   16  12  4  0  2.286  0.871
  //  10   15   8  1  1  0.652  0.227
  //  11   13   8  2  0  1.238  0.448
  //  12   12   6  2  0  1.333  0.418
  //  13   12   4  1  1  0.750  0.188
  //  15   11   4  1  0  0.733  0.196
  //  16   11   3  1  1  0.786  0.168
  //  17   10   3  1  0  0.769  0.178
  //  22    7   2  2  1  1.556  0.302
  //  23    6   1  2  1  1.714  0.204
  // Sum: O = 9, E = 19.25, V = 6.257, so chi-square = (9 - 19.25)^2 / 6.257 = 16.79 on 1 df.
  // The hand calculation agrees with the expected value of about 16.79.
  it("reproduces the 6-MP vs placebo statistic", () => {
    const r = logRank([SIX_MP, PLACEBO]);
    assert.equal(r.df, 1);
    assert.deepEqual(r.observed, [9, 21]);
    assert.ok(Math.abs(r.expected[0] - 19.25) < 0.005);
    assert.ok(Math.abs(r.expected[1] - 10.75) < 0.005);
    assert.ok(Math.abs(r.chiSquare - 16.79) < 0.01, `chi2 = ${r.chiSquare}`);
    assert.ok(r.pValue < 0.001);
  });

  it("is symmetric in the group order", () => {
    const a = logRank([SIX_MP, PLACEBO]);
    const b = logRank([PLACEBO, SIX_MP]);
    assert.ok(Math.abs(a.chiSquare - b.chiSquare) < 1e-9);
  });

  // Two strata, group 1 vs group 2 (E = event, c = censored).
  //  Stratum A: g1 {1E, 3E}, g2 {2E, 4E}
  //    t=1: n1=2 n2=2 N=4 d=1 -> O1=1 E1=.5   V=2*2*1*3/(16*3)=1/4
  //    t=2: n1=1 n2=2 N=3 d=1 -> O1=0 E1=1/3  V=1*2*1*2/(9*2)=2/9
  //    t=3: n1=1 n2=1 N=2 d=1 -> O1=1 E1=.5   V=1/4
  //    t=4: N=1, no variance
  //    A: O1=2, E1=4/3, V=13/18
  //  Stratum B: g1 {5E, 6E}, g2 {5E, 7c}
  //    t=5: n1=2 n2=2 N=4 d=2 -> O1=1 E1=1    V=2*2*2*2/(16*3)=1/3
  //    t=6: n1=1 n2=1 N=2 d=1 -> O1=1 E1=.5   V=1/4
  //    B: O1=2, E1=3/2, V=7/12
  //  Total: O1=4, E1=17/6, V=47/36, chi-square = (7/6)^2 / (47/36) = 49/47 = 1.0426
  it("matches a hand-worked two-strata example", () => {
    const g1 = [obs(1, true, "A"), obs(3, true, "A"), obs(5, true, "B"), obs(6, true, "B")];
    const g2 = [obs(2, true, "A"), obs(4, true, "A"), obs(5, true, "B"), obs(7, false, "B")];
    const r = logRank([g1, g2]);
    assert.equal(r.observed[0], 4);
    assert.ok(Math.abs(r.expected[0] - 17 / 6) < 1e-9);
    assert.ok(Math.abs(r.chiSquare - 49 / 47) < 1e-9);
    // Pooling the strata gives a different answer.
    const pooled = logRank([g1.map((o) => ({ ...o, stratum: undefined })), g2.map((o) => ({ ...o, stratum: undefined }))]);
    assert.ok(Math.abs(pooled.chiSquare - r.chiSquare) > 1e-3);
  });

  it("supports three groups on 2 df", () => {
    const r = logRank([SIX_MP, PLACEBO, PLACEBO.map((o) => ({ ...o, time: o.time + 1 }))]);
    assert.equal(r.df, 2);
    assert.ok(r.chiSquare > 0);
    assert.ok(r.pValue >= 0 && r.pValue <= 1);
  });

  it("returns a null result for empty or all-censored input", () => {
    const empty = logRank([[], []]);
    assert.equal(empty.chiSquare, 0);
    assert.equal(empty.pValue, 1);
    const oneEmpty = logRank([SIX_MP, []]);
    assert.equal(oneEmpty.df, 0);
    assert.equal(oneEmpty.pValue, 1);
    const censored = logRank([[obs(1, false), obs(2, false)], [obs(3, false)]]);
    assert.equal(censored.chiSquare, 0);
    assert.equal(censored.pValue, 1);
    assert.deepEqual(censored.observed, [0, 0]);
  });
});
