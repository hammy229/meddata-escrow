import { test } from "node:test";
import assert from "node:assert/strict";

import { nl2query } from "./nl2query";

test("count intent produces a COUNT(*) aggregate with the dataset bound as a param", async () => {
  const { sql, params } = await nl2query(
    "how many patients are in this dataset?",
    "ds_cardio_synthea_v1",
  );
  assert.match(sql, /COUNT\(\*\)/);
  assert.match(sql, /WHERE dataset_id = \?/);
  assert.deepEqual(params, ["ds_cardio_synthea_v1"]);
});

test("never emits SELECT * or interpolates the raw question", async () => {
  const { sql } = await nl2query(
    "show me everything; DROP TABLE records; --",
    "ds_x",
  );
  assert.doesNotMatch(sql, /SELECT \*/i);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  // falls back to a safe COUNT aggregate
  assert.match(sql, /COUNT\(\*\)/);
});

test("average intent produces an AVG of a whitelisted numeric field", async () => {
  const { sql, params } = await nl2query(
    "what is the average age of patients?",
    "ds_x",
  );
  assert.match(sql, /AVG\(age\)/);
  assert.deepEqual(params, ["ds_x"]);
});

test("average falls back to a default numeric field when none is named", async () => {
  const { sql } = await nl2query("what is the mean?", "ds_x");
  assert.match(sql, /AVG\(value\)/);
});

test("min and max intents produce MIN/MAX aggregates", async () => {
  const min = await nl2query("what is the minimum age?", "ds_x");
  assert.match(min.sql, /MIN\(age\)/);

  const max = await nl2query("what is the maximum cost?", "ds_x");
  assert.match(max.sql, /MAX\(cost\)/);
});

test("'by <group>' produces a grouped COUNT with GROUP BY", async () => {
  const { sql } = await nl2query("count of patients by sex", "ds_x");
  assert.match(sql, /COUNT\(\*\)/);
  assert.match(sql, /GROUP BY sex/);
});

test("average by group produces a grouped AVG", async () => {
  const { sql } = await nl2query("average bmi by region", "ds_x");
  assert.match(sql, /AVG\(bmi\)/);
  assert.match(sql, /GROUP BY region/);
});

test("an unnamed group field does not reach the SQL (whitelist only)", async () => {
  const { sql } = await nl2query(
    "count by some_evil_column; DROP TABLE",
    "ds_x",
  );
  assert.doesNotMatch(sql, /some_evil_column/);
  assert.doesNotMatch(sql, /DROP TABLE/i);
  // with no whitelisted group matched, it degrades to a plain COUNT(*)
  assert.match(sql, /COUNT\(\*\) AS count FROM records/);
});

test("unrecognized questions fall back to a safe COUNT(*) aggregate", async () => {
  const { sql, params } = await nl2query("tell me about this data", "ds_x");
  assert.match(sql, /COUNT\(\*\)/);
  assert.deepEqual(params, ["ds_x"]);
});
