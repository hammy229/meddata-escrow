import { test } from "node:test";
import assert from "node:assert/strict";

import { buildShortlist } from "./shortlist";
import type { AgentStep } from "./tools";

const at = "2026-10-29T00:00:00.000Z";
const step = (tool: string, output?: unknown, error?: string): AgentStep => ({
  tool,
  input: {},
  at,
  ...(error ? { error } : { output }),
});

const search = step("search_datasets", {
  matches: [
    {
      datasetId: "ds_a",
      title: "Alpha",
      score: 5,
      rationale: "matches cardiology terms",
      priceCents: 4900,
      withinBudget: true,
    },
    {
      datasetId: "ds_b",
      title: "Beta",
      score: 9,
      rationale: "strong overlap",
      priceCents: 90000,
      withinBudget: false,
    },
    {
      datasetId: "ds_c",
      title: "Gamma",
      score: 3,
      rationale: "weak overlap",
      priceCents: 2000,
      withinBudget: true,
    },
  ],
});

test("chosen dataset ranks first with a reason built from the search", () => {
  const items = buildShortlist(
    [
      search,
      step("check_sample", { datasetId: "ds_a", passed: true, findings: [] }),
      step("create_escrow_order", { datasetId: "ds_a" }),
    ],
    { datasetId: "ds_a" },
  );
  assert.deepEqual(
    items.map((i) => i.datasetId),
    ["ds_a", "ds_c", "ds_b"],
  );
  assert.deepEqual(items[0], {
    datasetId: "ds_a",
    title: "Alpha",
    priceCents: 4900,
    fitScore: 5,
    sampleCheck: "passed",
    withinBudget: true,
    reason: "Chosen: matches cardiology terms",
    chosen: true,
  });
  assert.equal(items.filter((i) => i.chosen).length, 1);
});

test("over-budget and failed candidates explain themselves", () => {
  const items = buildShortlist(
    [
      search,
      step("check_sample", {
        datasetId: "ds_c",
        passed: false,
        findings: ["PASS: size", "FAIL: only 800 records"],
      }),
    ],
    { datasetId: null },
  );
  const by = Object.fromEntries(items.map((i) => [i.datasetId, i]));
  assert.equal(by.ds_b.reason, "Over budget at $900.00.");
  assert.equal(by.ds_c.sampleCheck, "failed");
  assert.equal(by.ds_c.reason, "Failed its sample check: only 800 records");
  assert.equal(by.ds_a.sampleCheck, "not_run");
  assert.ok(items.every((i) => !i.chosen));
  // In budget and unchecked outranks over budget, despite Beta's higher score.
  assert.equal(items[items.length - 1].datasetId, "ds_b");
});

test("a dataset seen only via get_dataset is included", () => {
  const items = buildShortlist([
    step("get_dataset", {
      datasetId: "ds_z",
      title: "Zed",
      priceCents: 1000,
      withinBudget: true,
    }),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].fitScore, null);
  assert.equal(items[0].title, "Zed");
});

test("refused steps are ignored and the budget fills a missing flag", () => {
  const items = buildShortlist(
    [
      step("create_escrow_order", undefined, "price exceeds the budget"),
      step("search_datasets", {
        matches: [{ datasetId: "ds_q", score: 1, priceCents: 500 }],
      }),
    ],
    null,
    400,
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].withinBudget, false);
  assert.equal(items[0].chosen, false);
});

test("empty, malformed and long inputs are safe", () => {
  assert.deepEqual(buildShortlist([]), []);
  assert.deepEqual(
    buildShortlist([
      step("search_datasets", { matches: "nope" }),
      step("check_sample", "garbage"),
    ]),
    [],
  );
  const long = buildShortlist([
    step("search_datasets", {
      matches: [{ datasetId: "ds_l", score: 1, rationale: "x".repeat(400) }],
    }),
  ]);
  assert.ok(long[0].reason.length <= 140);
});
