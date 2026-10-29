import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkQuestion } from "../ai/privacy-guard";
import { keywordPlan, nl2query } from "../ai/nl2query";
import { suggestQuestions } from "./suggestions";

const catalog = JSON.parse(
  readFileSync(new URL("../../data/catalog.json", import.meta.url), "utf8"),
) as { id: string }[];
const ids = [...catalog.map((d) => d.id), "ds_unknown"];

test("every dataset gets three or four distinct questions", () => {
  for (const id of ids) {
    const qs = suggestQuestions(id);
    assert.ok(qs.length >= 3 && qs.length <= 4, id);
    assert.equal(new Set(qs).size, qs.length, id);
  }
});

test("datasets get different questions from their own columns", () => {
  const [a, b] = catalog.map((d) => suggestQuestions(d.id));
  assert.notDeepEqual(a, b);
});

test("every suggestion passes the privacy question check", async () => {
  for (const id of ids) {
    for (const q of suggestQuestions(id)) {
      const verdict = await checkQuestion(q, id, { useLlm: false });
      assert.equal(verdict.allowed, true, `${id}: ${q} -> ${verdict.reasons}`);
    }
  }
});

test("every suggestion compiles to an aggregate through the keyword planner", async () => {
  for (const id of ids) {
    for (const q of suggestQuestions(id)) {
      const compiled = await nl2query(q, id, { useLlm: false });
      assert.equal(compiled.source, "keyword", q);
      assert.match(compiled.sql, /COUNT\(|AVG\(|MIN\(|MAX\(/, q);
      assert.deepEqual(compiled.params, [id]);
    }
  }
});

test("each suggestion plans the operation its wording names", () => {
  const [total, grouped, average, extreme] = suggestQuestions(
    "ds_cardio_synthea_v1",
  );
  assert.deepEqual(keywordPlan(total), {
    op: "count",
    field: null,
    groupBy: null,
  });
  assert.deepEqual(keywordPlan(grouped), {
    op: "count",
    field: null,
    groupBy: "diagnosis",
  });
  assert.deepEqual(keywordPlan(average), {
    op: "avg",
    field: "bmi",
    groupBy: "sex",
  });
  assert.deepEqual(keywordPlan(extreme), {
    op: "max",
    field: "age",
    groupBy: null,
  });
});
