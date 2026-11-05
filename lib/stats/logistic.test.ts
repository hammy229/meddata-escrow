import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRng } from "../synth/prng";
import {
  brierScore,
  fitLogistic,
  holdoutEvaluate,
  predictProba,
  stratifiedFolds,
  stratifiedSplit,
  type Cell,
} from "./logistic";

function generate(n: number, seed: number, beta: number[], intercept: number) {
  const rng = createRng(seed);
  const rows: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = beta.map(() => rng.normal(0, 1));
    let z = intercept;
    x.forEach((v, c) => (z += beta[c] * v));
    rows.push(x);
    y.push(rng.chance(1 / (1 + Math.exp(-z))) ? 1 : 0);
  }
  return { rows, y };
}

describe("logistic regression", () => {
  it("recovers known coefficients on generated data", () => {
    const beta = [1.5, -1, 0];
    const { rows, y } = generate(6000, 11, beta, 0.3);
    const m = fitLogistic(rows, y, { l2: 0.01 });
    // Features are N(0,1) so standardized weights are close to raw ones.
    assert.ok(Math.abs(m.coef[0] - 1.5) < 0.15, `b0 ${m.coef[0]}`);
    assert.ok(Math.abs(m.coef[1] + 1) < 0.15, `b1 ${m.coef[1]}`);
    assert.ok(Math.abs(m.coef[2]) < 0.12, `b2 ${m.coef[2]}`);
    assert.ok(Math.abs(m.intercept - 0.3) < 0.12, `intercept ${m.intercept}`);
  });

  it("scores about 0.5 AUC on pure noise", () => {
    const { rows, y } = generate(2000, 5, [0, 0, 0, 0], 0);
    const r = holdoutEvaluate(rows, y, 1);
    assert.ok(r.auc !== null && Math.abs(r.auc - 0.5) < 0.07, `auc ${r.auc}`);
  });

  it("scores well above chance when there is signal", () => {
    const { rows, y } = generate(2000, 6, [2, 1], 0);
    const r = holdoutEvaluate(rows, y, 1);
    assert.ok(r.auc !== null && r.auc > 0.8);
    assert.ok(r.brier < 0.2);
  });

  it("does not let test rows reach training", () => {
    const { rows, y } = generate(500, 7, [1, 1], 0);
    const { test } = stratifiedSplit(y, 0.3, 9);
    const a = holdoutEvaluate(rows, y, 9);
    const poisoned = rows.map((r, i) => (test.includes(i) ? [1e9, -1e9] : r));
    const b = holdoutEvaluate(poisoned, y, 9);
    assert.deepEqual(b.model.coef, a.model.coef);
    assert.equal(b.model.intercept, a.model.intercept);
    assert.deepEqual(b.model.prep, a.model.prep);
  });

  it("learns imputation from train rows only, with a missing indicator", () => {
    const rows: Cell[][] = [[1], [3], [null], [5], [7], [9]];
    const y = [0, 0, 1, 1, 0, 1];
    const m = fitLogistic(rows, y);
    assert.equal(m.prep.means[0], 5);
    assert.deepEqual(m.prep.indicatorFor, [0]);
    assert.equal(m.coef.length, 2);
    const noGap = fitLogistic([[1], [2], [3], [4]], [0, 1, 0, 1]);
    assert.deepEqual(noGap.prep.indicatorFor, []);
    // A test-time gap is filled with the train mean, not a test statistic.
    const p = predictProba(noGap, [[null]]);
    assert.ok(Number.isFinite(p[0]));
  });

  it("does not diverge on perfectly separable data", () => {
    const rows = [[-3], [-2], [-1], [1], [2], [3]];
    const y = [0, 0, 0, 1, 1, 1];
    const m = fitLogistic(rows, y);
    assert.ok(Number.isFinite(m.intercept) && m.coef.every((c) => Number.isFinite(c) && Math.abs(c) < 50));
    const p = predictProba(m, rows);
    assert.ok(p[0] < 0.5 && p[5] > 0.5);
  });

  it("is deterministic for a seed and differs across seeds", () => {
    const { rows, y } = generate(400, 3, [1, -1], 0);
    const a = holdoutEvaluate(rows, y, 4);
    const b = holdoutEvaluate(rows, y, 4);
    assert.deepEqual(a, b);
    assert.notDeepEqual(stratifiedSplit(y, 0.3, 4), stratifiedSplit(y, 0.3, 5));
  });

  it("keeps the class mix when splitting and never overlaps", () => {
    const y = Array.from({ length: 100 }, (_, i) => (i < 20 ? 1 : 0));
    const { train, test } = stratifiedSplit(y, 0.25, 2);
    assert.equal(train.length + test.length, 100);
    assert.equal(new Set([...train, ...test]).size, 100);
    assert.equal(test.filter((i) => y[i] === 1).length, 5);
    assert.equal(test.filter((i) => y[i] === 0).length, 20);
  });

  it("makes folds that cover every row once and spread each class", () => {
    const y = Array.from({ length: 50 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    const folds = stratifiedFolds(y, 5, 3);
    assert.equal(folds.flat().length, 50);
    assert.equal(new Set(folds.flat()).size, 50);
    for (const f of folds) assert.equal(f.filter((i) => y[i] === 1).length, 2);
    assert.deepEqual(folds, stratifiedFolds(y, 5, 3));
  });

  it("computes the Brier score and rejects bad input", () => {
    assert.equal(brierScore([1, 0], [1, 0]), 0);
    assert.equal(brierScore([0.5, 0.5], [1, 0]), 0.25);
    assert.throws(() => brierScore([], []));
    assert.throws(() => fitLogistic([], []));
  });
});
