import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dashFor,
  formatP,
  markerFor,
  spreadLabels,
  stepPath,
  supportsSurvival,
  DASHES,
} from "./survival-chart";

test("stepPath holds a level, then drops", () => {
  const d = stepPath(
    [
      { month: 0, survival: 1 },
      { month: 3, survival: 0.9 },
      { month: 6, survival: 0.5 },
    ],
    (m) => m * 10,
    (s) => 100 - s * 100,
  );
  assert.equal(d, "M0 0 H30 V10 H60 V50");
  assert.equal(
    stepPath(
      [],
      (m) => m,
      (s) => s,
    ),
    "",
  );
});

test("spreadLabels keeps labels apart and inside the box", () => {
  const out = spreadLabels([50, 51, 52, 53], 14, 10, 200);
  for (let i = 1; i < out.length; i += 1)
    assert.ok(out[i] - out[i - 1] >= 14 - 1e-9);
  assert.ok(Math.min(...out) >= 10 && Math.max(...out) <= 200);
  // Order of the input is kept in the output.
  const mixed = spreadLabels([100, 20], 14, 0, 300);
  assert.ok(mixed[1] < mixed[0]);
  // A stack pushed past the bottom is pulled back up.
  const low = spreadLabels([195, 196, 197], 14, 0, 200);
  assert.ok(Math.max(...low) <= 200);
  for (let i = 1; i < low.length; i += 1)
    assert.ok(low[i] - low[i - 1] >= 14 - 1e-9);
  assert.deepEqual(spreadLabels([], 14, 0, 10), []);
});

test("formatP", () => {
  assert.equal(formatP(0.0000141), "below 0.001");
  assert.equal(formatP(0.3261), "0.326");
  assert.equal(formatP(null), "not available");
});

test("every group gets a different dash and marker up to the pattern count", () => {
  const dashes = new Set(
    Array.from({ length: DASHES.length }, (_, i) => dashFor(i)),
  );
  assert.equal(dashes.size, DASHES.length);
  const markers = new Set(Array.from({ length: 5 }, (_, i) => markerFor(i)));
  assert.equal(markers.size, 5);
});

test("only ALS fixture listings offer survival", () => {
  assert.equal(supportsSurvival("ds_als_survival_curated_v1"), true);
  assert.equal(supportsSurvival("ds_cardio_synthea_v1"), false);
});
