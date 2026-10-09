import { test } from "node:test";
import assert from "node:assert/strict";

import { checkQuery, checkResult, MIN_CELL_SIZE } from "./privacy-guard";

test("allows a plain aggregate query", async () => {
  const v = await checkQuery(
    "SELECT COUNT(*) AS count FROM records WHERE dataset_id = ?",
    "ds_x",
  );
  assert.equal(v.allowed, true);
  assert.deepEqual(v.reasons, []);
});

test("allows a grouped aggregate query", async () => {
  const v = await checkQuery(
    'SELECT sex AS "group", AVG(age) AS avg_age FROM records WHERE dataset_id = ? GROUP BY sex',
    "ds_x",
  );
  assert.equal(v.allowed, true);
});

test("rejects SELECT * row-level export", async () => {
  const v = await checkQuery("SELECT * FROM records", "ds_x");
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /SELECT \*/.test(r)));
});

test("rejects queries referencing PII columns", async () => {
  const v = await checkQuery(
    "SELECT name, ssn FROM records WHERE dataset_id = ?",
    "ds_x",
  );
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /name/.test(r)));
  assert.ok(v.reasons.some((r) => /ssn/.test(r)));
});

test("rejects single-record LIMIT 1 pulls", async () => {
  const v = await checkQuery(
    "SELECT COUNT(*) FROM records WHERE dataset_id = ? LIMIT 1",
    "ds_x",
  );
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /single record/i.test(r)));
});

test("rejects a non-aggregate query (fail closed)", async () => {
  const v = await checkQuery("SELECT age FROM records", "ds_x");
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /aggregate/i.test(r)));
});

test("checkResult allows results whose every cell is >= MIN_CELL_SIZE", async () => {
  const v = await checkResult([
    { group: "M", count: MIN_CELL_SIZE },
    { group: "F", count: 42 },
  ]);
  assert.equal(v.allowed, true);
  assert.deepEqual(v.reasons, []);
});

test("checkResult suppresses results with a small cell and names it", async () => {
  const v = await checkResult([
    { group: "M", count: 50 },
    { group: "F", count: 3 },
  ]);
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /F/.test(r) && /3/.test(r)));
});

test("checkResult is defensive about row shape and finds alternate count keys", async () => {
  const v = await checkResult([{ label: "2023", n: 2 }]);
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /2023/.test(r)));
});

test("checkResult ignores rows with no interpretable count", async () => {
  const v = await checkResult([{ note: "no count here" }, { count: 20 }]);
  assert.equal(v.allowed, true);
});

test("checkResult fails closed on a non-array", async () => {
  // @ts-expect-error intentionally wrong shape
  const v = await checkResult(null);
  assert.equal(v.allowed, false);
});
