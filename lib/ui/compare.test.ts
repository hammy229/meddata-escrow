import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_COMPARE,
  bestFlags,
  compareRows,
  reconcileCompare,
  toggleCompare,
  type Comparable,
} from "./compare";

const m = (id: string, over: Partial<Comparable> = {}): Comparable => ({
  datasetId: id,
  title: id,
  score: 5,
  rationale: `why ${id}`,
  priceCents: 4900,
  ...over,
});

test("toggleCompare adds, removes and stops at the cap", () => {
  let ids: string[] = [];
  ids = toggleCompare(ids, "a");
  ids = toggleCompare(ids, "b");
  ids = toggleCompare(ids, "c");
  assert.deepEqual(ids, ["a", "b", "c"]);
  assert.equal(ids.length, MAX_COMPARE);
  assert.deepEqual(toggleCompare(ids, "d"), ["a", "b", "c"]);
  assert.deepEqual(toggleCompare(ids, "b"), ["a", "c"]);
});

test("reconcileCompare keeps earlier picks first and caps at three", () => {
  assert.deepEqual(reconcileCompare(["a", "b"], ["b", "c", "a"]), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(reconcileCompare(["a", "b", "c"], ["d", "c", "b", "a"]), [
    "a",
    "b",
    "c",
  ]);
  assert.deepEqual(reconcileCompare(["a"], []), []);
});

test("bestFlags picks the lowest or highest value", () => {
  assert.deepEqual(bestFlags([4900, 5900, 4900], "low"), [true, false, true]);
  assert.deepEqual(bestFlags([10, 30, 20], "high"), [false, true, false]);
});

test("bestFlags flags nothing for ties, single values and gaps", () => {
  assert.deepEqual(bestFlags([5, 5], "high"), [false, false]);
  assert.deepEqual(bestFlags([5], "high"), [false]);
  assert.deepEqual(bestFlags([], "low"), []);
  assert.deepEqual(bestFlags([undefined, 7], "high"), [false, false]);
  assert.deepEqual(bestFlags([null, 3, 9], "high"), [false, false, true]);
});

test("compareRows marks the cheapest, biggest and best-fitting pick", () => {
  const rows = compareRows([
    m("a", { priceCents: 4900, recordCount: 10000, score: 3 }),
    m("b", { priceCents: 5900, recordCount: 8000, score: 7 }),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.deepEqual(
    by.price.cells.map((c) => c.best),
    [true, false],
  );
  assert.equal(by.price.cells[0].text, "$49.00");
  assert.deepEqual(
    by.records.cells.map((c) => c.best),
    [true, false],
  );
  assert.equal(by.records.cells[0].text, "10,000");
  assert.deepEqual(
    by.fit.cells.map((c) => c.best),
    [false, true],
  );
  assert.equal(by.why.cells[1].text, "why b");
});

test("compareRows shows unknown record counts and ignores a fourth pick", () => {
  const rows = compareRows([m("a"), m("b"), m("c"), m("d")]);
  assert.equal(rows[0].cells.length, MAX_COMPARE);
  assert.equal(rows[1].cells[0].text, "Not listed");
  assert.ok(rows[1].cells.every((c) => !c.best));
  assert.deepEqual(
    compareRows([]).map((r) => r.cells.length),
    [0, 0, 0, 0],
  );
});
