import { test } from "node:test";
import assert from "node:assert/strict";

import {
  numbersGrounded,
  ruleSummary,
  summarizeAnswer,
} from "./answer-summary";
import { compilePlan } from "./nl2query";
import { failingLlm, fakeLlm } from "./testing";

const count = compilePlan({ op: "count", field: null, groupBy: null }, "ds");
const bySex = compilePlan({ op: "count", field: null, groupBy: "sex" }, "ds");
const avgRegion = compilePlan(
  { op: "avg", field: "age", groupBy: "region" },
  "ds",
);
const maxAge = compilePlan({ op: "max", field: "age", groupBy: null }, "ds");

test("scalar count summary is deterministic", () => {
  assert.equal(
    ruleSummary(count, [{ count: 1234 }]),
    "There are 1,234 patients.",
  );
});

test("grouped count names the total and the largest group", () => {
  assert.equal(
    ruleSummary(bySex, [
      { group: "female", count: 100 },
      { group: "male", count: 250 },
    ]),
    "350 patients across 2 groups by sex; the largest is male with 250.",
  );
});

test("grouped average reports the range", () => {
  assert.equal(
    ruleSummary(avgRegion, [
      { group: "west", avg_age: 41 },
      { group: "south", avg_age: 70.25 },
    ]),
    "The average age by region ranges from 41 (west) to 70.3 (south).",
  );
});

test("scalar max and empty results", () => {
  assert.equal(ruleSummary(maxAge, [{ max_age: 91 }]), "The max age is 91.");
  assert.equal(ruleSummary(count, []), "The query returned no rows.");
});

test("suppressed cells are never quoted", () => {
  const s = ruleSummary(bySex, [
    { group: "female", count: 4 },
    { group: "male", count: 250 },
  ]);
  assert.match(s, /1 group withheld for privacy/);
  assert.doesNotMatch(s, /\b4\b/);
  assert.equal(
    ruleSummary(bySex, [{ group: "female", count: 4 }]),
    "Every group was withheld for privacy.",
  );
});

test("number guard accepts grounded and rejects invented numbers", () => {
  const rows = [{ count: 1234 }];
  const rule = ruleSummary(count, rows);
  assert.equal(
    numbersGrounded("About 1,234 people are in it.", rows, rule),
    true,
  );
  assert.equal(
    numbersGrounded("About 1,300 people are in it.", rows, rule),
    false,
  );
  assert.equal(numbersGrounded("No digits here.", rows, rule), true);
});

test("mock path (LLM off) returns the rule summary without calling a model", async () => {
  const { client, calls } = fakeLlm({ summary: "x" });
  const rows = [{ count: 1234 }];
  const s = await summarizeAnswer("how many?", count, rows, {
    client,
    useLlm: false,
  });
  assert.equal(s, ruleSummary(count, rows));
  assert.equal(calls.length, 0);
});

test("LLM reword with grounded numbers is used", async () => {
  const { client, calls } = fakeLlm({
    summary: "The cohort holds 1,234 patients.",
  });
  const s = await summarizeAnswer("how many?", count, [{ count: 1234 }], {
    client,
    useLlm: true,
  });
  assert.equal(s, "The cohort holds 1,234 patients.");
  assert.equal(calls.length, 1);
});

test("LLM sentence with an invented number falls back to the rule summary", async () => {
  const { client } = fakeLlm({ summary: "There are 5,000 patients." });
  const rows = [{ count: 1234 }];
  const s = await summarizeAnswer("how many?", count, rows, {
    client,
    useLlm: true,
  });
  assert.equal(s, ruleSummary(count, rows));
});

test("LLM failure or multi-line output falls back to the rule summary", async () => {
  const rows = [{ count: 1234 }];
  const rule = ruleSummary(count, rows);
  const failing = failingLlm();
  assert.equal(
    await summarizeAnswer("q", count, rows, {
      client: failing.client,
      useLlm: true,
    }),
    rule,
  );
  const multi = fakeLlm({ summary: "Line one.\nLine two 1,234." });
  assert.equal(
    await summarizeAnswer("q", count, rows, {
      client: multi.client,
      useLlm: true,
    }),
    rule,
  );
});
