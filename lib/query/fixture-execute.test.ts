import assert from "node:assert/strict";
import { test } from "node:test";

import { nl2query, type QueryPlan } from "../ai/nl2query";
import { checkResult } from "../ai/privacy-guard";
import { fixtureCohort, fixtureSpec } from "../fitness/source";
import catalog from "../../data/catalog.json";
import { aggregateRows, executeFixture, type RecordRow } from "./fixture-execute";
import { suggestQuestions } from "./suggestions";

const ALS_IDS = [
  "ds_als_survival_axonpoint_v1",
  "ds_als_survival_motorneuron_v1",
  "ds_als_survival_curated_v1",
];

const count: QueryPlan = { op: "count", field: null, groupBy: null };

function rowsOf(id: string, plan: QueryPlan) {
  const out = executeFixture(id, plan);
  assert.equal(out.kind, "rows");
  return out.kind === "rows" ? out.rows : [];
}

test("a dataset without a fixture is left to the mock", () => {
  assert.deepEqual(executeFixture("ds_cardio_synthea_v1", count), { kind: "none" });
  assert.deepEqual(executeFixture("ds_unknown", count), { kind: "none" });
});

test("the listing's record count is visits, but a count question counts people", () => {
  for (const id of ALS_IDS) {
    const entry = (catalog as { id: string; recordCount: number }[]).find((d) => d.id === id)!;
    const cohort = fixtureCohort(id, "delivery")!;
    assert.ok(entry.recordCount >= 1000);
    assert.equal(entry.recordCount, cohort.visits.length, id);
    assert.deepEqual(rowsOf(id, count), [{ count: cohort.subjects.length }]);
  }
});

test("average age counts each person once, however many visits they had", () => {
  const id = ALS_IDS[1];
  const ages = fixtureCohort(id, "delivery")!.subjects.map((s) => s.age_at_onset);
  const mean = Math.round((ages.reduce((s, v) => s + v, 0) / ages.length) * 100) / 100;
  assert.deepEqual(rowsOf(id, { op: "avg", field: "age", groupBy: null }), [{ avg_age: mean }]);
});

test("the cell floor counts people, so many visits from a few people stay hidden", () => {
  const rows = Array.from({ length: 50 }, (_, i): RecordRow => ({
    subject: `s${i % 10}`,
    age: 60,
    sex: "male",
    age_group: "60-69",
    score: 30,
    value: 80,
  }));
  for (const plan of [count, { op: "avg", field: "score", groupBy: null }] as QueryPlan[]) {
    assert.deepEqual(aggregateRows(rows, plan), { kind: "rows", rows: [] });
  }
});

test("grouped counts add up to the total", () => {
  for (const id of ALS_IDS) {
    const total = rowsOf(id, count)[0].count as number;
    for (const groupBy of ["sex", "age_group"] as const) {
      const rows = rowsOf(id, { op: "count", field: null, groupBy });
      assert.ok(rows.length >= 2);
      assert.equal(
        rows.reduce((s, r) => s + (r.count as number), 0),
        total,
      );
    }
  }
});

test("averages and extremes match the underlying rows", () => {
  const id = ALS_IDS[1];
  const c = fixtureCohort(id, "delivery")!;
  const scores = c.visits.map((v) => v.alsfrs_total);
  const mean = Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 100) / 100;
  assert.deepEqual(rowsOf(id, { op: "avg", field: "score", groupBy: null }), [{ avg_score: mean }]);
  assert.deepEqual(rowsOf(id, { op: "max", field: "score", groupBy: null }), [{ max_score: Math.max(...scores) }]);
  assert.deepEqual(rowsOf(id, { op: "min", field: "age", groupBy: null }), [
    { min_age: Math.min(...c.subjects.map((s) => s.age_at_onset)) },
  ]);
});

test("value is FVC and skips visits where it was not recorded", () => {
  const id = ALS_IDS[0];
  const fvc = fixtureCohort(id, "delivery")!.visits.flatMap((v) => (v.fvc_pct === null ? [] : [v.fvc_pct]));
  const mean = Math.round((fvc.reduce((s, v) => s + v, 0) / fvc.length) * 100) / 100;
  assert.deepEqual(rowsOf(id, { op: "avg", field: "value", groupBy: null }), [{ avg_value: mean }]);
});

test("columns the rows do not have are refused with a reason", () => {
  for (const plan of [
    { op: "count", field: null, groupBy: "region" },
    { op: "count", field: null, groupBy: "diagnosis" },
    { op: "count", field: null, groupBy: "year" },
    { op: "avg", field: "bmi", groupBy: null },
    { op: "max", field: "cost", groupBy: null },
    { op: "min", field: "los", groupBy: null },
  ] as QueryPlan[]) {
    const out = executeFixture(ALS_IDS[0], plan);
    assert.equal(out.kind, "refused", JSON.stringify(plan));
    if (out.kind === "refused") assert.match(out.reason, /No query charge was recorded/);
  }
});

test("MIN and MAX ignore a group, as the planner does", () => {
  const out = executeFixture(ALS_IDS[0], { op: "max", field: "age", groupBy: "region" });
  assert.equal(out.kind, "rows");
});

test("groups under the cell floor are dropped, and so are small tables", () => {
  let next = 0;
  const row = (age_group: string): RecordRow => ({ subject: `s${next++}`, age: 60, sex: "male", age_group, score: 30, value: 80 });
  const rows = [
    ...Array.from({ length: 11 }, () => row("50-59")),
    ...Array.from({ length: 10 }, () => row("70+")),
  ];
  const byAge = { op: "count", field: null, groupBy: "age_group" } as QueryPlan;
  // With two groups, showing one gives away the other by subtraction.
  assert.deepEqual(aggregateRows(rows, byAge), { kind: "rows", rows: [] });
  // With three, the small group takes the next smallest with it.
  const three = [...rows, ...Array.from({ length: 30 }, () => row("60-69"))];
  assert.deepEqual(aggregateRows(three, byAge), {
    kind: "rows",
    rows: [{ group: "60-69", count: 30 }],
  });
  assert.deepEqual(aggregateRows(rows.slice(0, 10), count), { kind: "rows", rows: [] });
  assert.deepEqual(aggregateRows(rows.slice(0, 11), count), { kind: "rows", rows: [{ count: 11 }] });
});

test("an all-missing field yields no row instead of a made-up number", () => {
  const rows = Array.from({ length: 12 }, (_, i): RecordRow => ({ subject: `s${i}`, age: 60, sex: "male", age_group: "60-69", score: 30, value: null }));
  assert.deepEqual(aggregateRows(rows, { op: "avg", field: "value", groupBy: null }), { kind: "rows", rows: [] });
});

test("every suggested question for an ALS listing runs and passes the result check", async () => {
  for (const id of ALS_IDS) {
    for (const q of suggestQuestions(id)) {
      const compiled = await nl2query(q, id, { useLlm: false });
      const out = executeFixture(id, compiled.plan!);
      assert.equal(out.kind, "rows", `${id}: ${q}`);
      if (out.kind !== "rows") continue;
      assert.ok(out.rows.length > 0, `${id}: ${q}`);
      assert.equal((await checkResult(out.rows)).allowed, true);
    }
  }
});

test("the same question on different ALS listings gives different, row-based answers", () => {
  const avgScore: QueryPlan = { op: "avg", field: "score", groupBy: null };
  const a = rowsOf(ALS_IDS[0], avgScore)[0].avg_score;
  const b = rowsOf(ALS_IDS[1], avgScore)[0].avg_score;
  assert.notEqual(a, b);
  assert.ok(fixtureSpec(ALS_IDS[0]));
});
