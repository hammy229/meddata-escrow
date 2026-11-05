import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mean, median, normalCdf, round, wilson } from "./stats";

describe("wilson", () => {
  it("matches known reference values", () => {
    // 8 of 10 at 95%: 0.4902 to 0.9433 (standard textbook value).
    const w = wilson(8, 10);
    assert.ok(Math.abs(w.lo - 0.4902) < 1e-3, String(w.lo));
    assert.ok(Math.abs(w.hi - 0.9433) < 1e-3, String(w.hi));
    assert.equal(w.rate, 0.8);
  });
  it("is not degenerate at 0 and n", () => {
    const zero = wilson(0, 200);
    assert.equal(zero.lo, 0);
    assert.ok(zero.hi > 0.015 && zero.hi < 0.02, String(zero.hi));
    const all = wilson(200, 200);
    assert.equal(all.hi, 1);
    assert.ok(all.lo > 0.98 && all.lo < 0.99);
  });
  it("handles n = 0 and rejects bad input", () => {
    assert.deepEqual(wilson(0, 0), { k: 0, n: 0, rate: 0, lo: 0, hi: 1 });
    assert.throws(() => wilson(5, 3));
    assert.throws(() => wilson(-1, 3));
    assert.throws(() => wilson(1.5, 3));
  });
  it("narrows as n grows", () => {
    const a = wilson(50, 100);
    const b = wilson(500, 1000);
    assert.ok(b.hi - b.lo < a.hi - a.lo);
  });
});

describe("helpers", () => {
  it("normalCdf hits known points", () => {
    assert.ok(Math.abs(normalCdf(0) - 0.5) < 1e-7);
    assert.ok(Math.abs(normalCdf(1.96) - 0.975) < 1e-4);
    assert.ok(Math.abs(normalCdf(-1) - 0.158655) < 1e-4);
  });
  it("mean, median and round", () => {
    assert.equal(mean([]), 0);
    assert.equal(mean([1, 2, 3]), 2);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(round(0.123456, 2), 0.12);
  });
});
