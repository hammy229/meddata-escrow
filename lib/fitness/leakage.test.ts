import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkLabelAssociation, checkTemporalLeak, rankAuc } from "./leakage";

describe("rankAuc", () => {
  // Hand count: positives vs negatives, win = 1, tie = 0.5.
  it("is 1 for perfect separation and 0 for the reverse", () => {
    assert.equal(rankAuc([1, 2, 3, 4], [0, 0, 1, 1]), 1);
    assert.equal(rankAuc([1, 2, 3, 4], [1, 1, 0, 0]), 0);
  });

  it("matches a hand count of 3 wins in 4 pairs", () => {
    // positives 2 and 4, negatives 1 and 3: 2>1, 2<3, 4>1, 4>3 -> 3/4
    assert.equal(rankAuc([1, 2, 3, 4], [0, 1, 0, 1]), 0.75);
  });

  it("counts ties as half", () => {
    // positives 1 and 2, negative 1: tie (0.5) + win (1) over 2 pairs
    assert.equal(rankAuc([1, 1, 2], [0, 1, 1]), 0.75);
    assert.equal(rankAuc([5, 5, 5, 5], [0, 1, 0, 1]), 0.5);
  });

  it("returns null when a class is empty", () => {
    assert.equal(rankAuc([1, 2], [1, 1]), null);
    assert.equal(rankAuc([], []), null);
  });
});

describe("checkLabelAssociation", () => {
  const rows = (pairs: [number, number][]) => pairs.map(([x, y]) => ({ x, y }));

  it("fails at 0.95 and above, in either direction", () => {
    // 30 positives (31..60) all above 30 negatives (1..30), then one positive moved to 0:
    // 29 positives win all 30 pairs, the moved one wins none -> 870/900 = .967
    const hi: [number, number][] = [];
    for (let i = 1; i <= 30; i += 1) hi.push([i, 0], [i + 30, 1]);
    hi[1] = [0, 1];
    const f = checkLabelAssociation(rows(hi), "y", ["x"])[0];
    assert.equal(f.severity, "fail");
    const flipped = hi.map(([x, y]): [number, number] => [-x, y]);
    assert.equal(checkLabelAssociation(rows(flipped), "y", ["x"])[0].severity, "fail");
  });

  it("warns between 0.90 and 0.95", () => {
    const near: [number, number][] = [];
    for (let i = 0; i < 10; i += 1) near.push([100 + i, 1]); // 10 positives high
    for (let i = 0; i < 9; i += 1) near.push([i, 0]); // 9 negatives low
    near.push([105.5, 0]); // one negative above 5 of the 10 positives
    // pairs = 100; the high negative loses to 4 positives (106..109) and beats 6 -> 94 wins -> .94
    const g = checkLabelAssociation(rows(near), "y", ["x"])[0];
    assert.equal(g.severity, "warn");
    assert.equal(g.metric?.auc, 0.94);
  });

  it("passes weak features and skips text and constant labels", () => {
    const weak = rows([
      [1, 0], [2, 1], [3, 0], [4, 1], [5, 0], [6, 1], [7, 0], [8, 1],
    ]);
    assert.equal(checkLabelAssociation(weak, "y", ["x"])[0].severity, "pass");
    const text = [{ x: "a", y: 0 }, { x: "b", y: 1 }];
    assert.equal(checkLabelAssociation(text, "y", ["x"])[0].severity, "pass");
    assert.equal(checkLabelAssociation(rows([[1, 1], [2, 1]]), "y", ["x"])[0].severity, "pass");
    assert.equal(checkLabelAssociation([], "y", ["x"])[0].severity, "pass");
  });

  it("ignores rows with a missing value", () => {
    const data = [
      { x: 1, y: 0 }, { x: 2, y: 0 }, { x: null, y: 1 }, { x: 9, y: 1 }, { x: 10, y: 1 },
    ];
    const f = checkLabelAssociation(data, "y", ["x"])[0];
    assert.equal(f.severity, "fail");
    assert.equal(f.metric?.rows, "fewer than 11");
  });
});

describe("checkTemporalLeak", () => {
  it("fails a feature derived from follow-up", () => {
    const f = checkTemporalLeak(["age", "last_score"], { last_score: "followup" });
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "fail");
    assert.equal(f[0].column, "last_score");
  });

  it("compares a recorded month with the landmark", () => {
    const timing = { early: 0, late: 6, edge: 3 };
    const f = checkTemporalLeak(["early", "late", "edge"], timing, 3);
    assert.deepEqual(f.map((x) => x.column), ["late"]);
  });

  it("passes when nothing is late and ignores columns outside the feature list", () => {
    assert.equal(checkTemporalLeak(["a"], {})[0].severity, "pass");
    assert.equal(checkTemporalLeak(["a"], { b: "followup" })[0].severity, "pass");
    assert.equal(checkTemporalLeak([], {})[0].severity, "pass");
  });
});
