import { test } from "node:test";
import assert from "node:assert/strict";

import { barFor, barMax } from "./bar-scale";

test("barMax is the largest absolute value in the column", () => {
  assert.equal(barMax([12, 40, 7]), 40);
  assert.equal(barMax([-90, 40]), 90);
});

test("barMax skips suppressed, missing and non-finite cells", () => {
  assert.equal(barMax(["suppressed", null, undefined, NaN, Infinity, 5]), 5);
  assert.equal(barMax([]), 0);
});

test("the largest value fills the cell and others scale to it", () => {
  assert.deepEqual(barFor(40, 40), { pct: 100, negative: false });
  assert.deepEqual(barFor(10, 40), { pct: 25, negative: false });
});

test("zero draws an empty bar, or nothing when the whole column is zero", () => {
  assert.deepEqual(barFor(0, 40), { pct: 0, negative: false });
  assert.equal(barFor(0, barMax([0, 0])), null);
});

test("suppressed and missing cells draw no bar", () => {
  assert.equal(barFor("<11", 40), null);
  assert.equal(barFor(null, 40), null);
  assert.equal(barFor(undefined, 40), null);
  assert.equal(barFor(NaN, 40), null);
});

test("negatives draw at their magnitude and are flagged", () => {
  assert.deepEqual(barFor(-20, 40), { pct: 50, negative: true });
  assert.deepEqual(barFor(-40, barMax([-40, 10])), {
    pct: 100,
    negative: true,
  });
});

test("a value above the max is clamped to the full width", () => {
  assert.equal(barFor(80, 40)?.pct, 100);
});
