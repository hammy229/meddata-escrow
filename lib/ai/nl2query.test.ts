import { test } from "node:test";
import assert from "node:assert/strict";

import { compilePlan, nl2query, type QueryPlan } from "./nl2query";
import { failingLlm, fakeLlm, promptOf } from "./testing";

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

// --- compilePlan (pure plan -> SQL) ---

test("compilePlan emits the same SQL shapes as the keyword path", () => {
  assert.equal(
    compilePlan({ op: "avg", field: "bmi", groupBy: "region" }, "ds_x").sql,
    'SELECT region AS "group", AVG(bmi) AS avg_bmi FROM records WHERE dataset_id = ? GROUP BY region',
  );
  assert.equal(
    compilePlan({ op: "count", field: "age", groupBy: null }, "ds_x").sql,
    "SELECT COUNT(*) AS count FROM records WHERE dataset_id = ?",
  );
});

test("compilePlan never groups MIN/MAX (an extreme can single someone out)", () => {
  const { sql, plan } = compilePlan(
    { op: "max", field: "age", groupBy: "diagnosis" },
    "ds_x",
  );
  assert.equal(
    sql,
    "SELECT MAX(age) AS max_age FROM records WHERE dataset_id = ?",
  );
  assert.equal(plan?.groupBy, null);
});

test("compilePlan rejects identifiers outside the whitelist", () => {
  assert.throws(() =>
    compilePlan(
      { op: "avg", field: "ssn", groupBy: null } as unknown as QueryPlan,
      "ds_x",
    ),
  );
});

// --- Claude query plan (fake client, no network) ---

test("compiles a Claude plan with the deterministic builder", async () => {
  const { client, calls } = fakeLlm({
    op: "avg",
    field: "los",
    groupBy: "year",
    explanation: "Average length of stay per year.",
  });
  const out = await nl2query(
    "how long do people stay, year over year?",
    "ds_x",
    {
      client,
      useLlm: true,
    },
  );
  assert.match(promptOf(calls[0]), /year over year/);
  assert.equal(
    out.sql,
    'SELECT year AS "group", AVG(los) AS avg_los FROM records WHERE dataset_id = ? GROUP BY year',
  );
  assert.deepEqual(out.params, ["ds_x"]);
  assert.deepEqual(out.plan, { op: "avg", field: "los", groupBy: "year" });
  assert.equal(out.explanation, "Average length of stay per year.");
  assert.equal(out.source, "llm");
});

test("an out-of-whitelist plan is rejected and the keyword parser answers", async () => {
  const { client } = fakeLlm({
    op: "avg",
    field: "age; DROP TABLE records",
    groupBy: "patient_id",
    explanation: "x",
  });
  const out = await nl2query("average age by sex", "ds_x", {
    client,
    useLlm: true,
  });
  assert.doesNotMatch(out.sql, /DROP|patient_id/);
  assert.equal(
    out.sql,
    'SELECT sex AS "group", AVG(age) AS avg_age FROM records WHERE dataset_id = ? GROUP BY sex',
  );
  assert.equal(out.source, "keyword");
});

test("an LLM failure falls back to the keyword parser", async () => {
  const { client } = failingLlm();
  const out = await nl2query("what is the minimum age?", "ds_x", {
    client,
    useLlm: true,
  });
  assert.match(out.sql, /MIN\(age\)/);
  assert.equal(out.source, "keyword");
});

test("with the LLM disabled the client is never called", async () => {
  const { client, calls } = fakeLlm({
    op: "max",
    field: "cost",
    groupBy: null,
  });
  const out = await nl2query("count of patients by sex", "ds_x", {
    client,
    useLlm: false,
  });
  assert.equal(calls.length, 0);
  assert.match(out.sql, /GROUP BY sex/);
  assert.equal(out.source, "keyword");
});
