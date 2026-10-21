// mockExecute spec — the synthesized aggregate must match the compiled query's
// shape (grouped COUNT vs grouped AVG vs scalar) and stay privacy-safe.
import { test } from "node:test";
import assert from "node:assert/strict";

import { mockExecute } from "./mock-execute";
import { nl2query } from "../ai/nl2query";
import { checkResult, MIN_CELL_SIZE } from "../ai/privacy-guard";

test("grouped COUNT yields { group, count } rows above the cell floor", async () => {
  const rows = mockExecute(await nl2query("how many patients by sex", "ds_x"));
  assert.deepEqual(
    rows.map((r) => r.group),
    ["female", "male"],
  );
  for (const row of rows) {
    assert.ok(typeof row.count === "number" && row.count >= MIN_CELL_SIZE);
  }
  assert.equal((await checkResult(rows)).allowed, true);
});

test("grouped AVG yields { group, avg_<field> } rows, not counts", async () => {
  const rows = mockExecute(await nl2query("average age by region", "ds_x"));
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["avg_age", "group"]);
    assert.equal(typeof row.avg_age, "number");
  }
  // Mean rows carry no count, so small-cell suppression has nothing to trip on.
  assert.equal((await checkResult(rows)).allowed, true);
});

test("scalar AVG yields a single row keyed by its alias", async () => {
  const rows = mockExecute(await nl2query("average bmi", "ds_x"));
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ["avg_bmi"]);
});
