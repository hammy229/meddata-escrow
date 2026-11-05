import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aggregate,
  hitAtK,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
  topLooksRelevant,
} from "./metrics";

const rel = { a: 2, b: 1 };

test("reciprocal rank is 1/rank of the first relevant result, 0 if none", () => {
  assert.equal(reciprocalRank(["a", "x"], rel), 1);
  assert.equal(reciprocalRank(["x", "b", "a"], rel), 0.5);
  assert.equal(reciprocalRank(["x", "y", "a"], rel), 1 / 3);
  assert.equal(reciprocalRank(["x", "y"], rel), 0);
  assert.equal(reciprocalRank([], rel), 0);
});

test("grade 0 and unlisted ids are not relevant", () => {
  assert.equal(reciprocalRank(["z", "a"], { a: 1, z: 0 }), 0.5);
});

test("recall@k is the share of relevant listings found in the top k", () => {
  assert.equal(recallAtK(["a", "x", "b"], rel, 1), 0.5);
  assert.equal(recallAtK(["a", "x", "b"], rel, 3), 1);
  assert.equal(recallAtK(["x", "y", "z"], rel, 3), 0);
  assert.equal(recallAtK(["a"], rel, 0), 0);
});

test("recall@k is undefined when nothing is relevant", () => {
  assert.equal(recallAtK(["a"], {}, 3), null);
  assert.equal(ndcgAtK(["a"], {}, 3), null);
});

test("hit@k is whether any relevant listing is in the top k", () => {
  assert.equal(hitAtK(["x", "a"], rel, 1), 0);
  assert.equal(hitAtK(["x", "a"], rel, 2), 1);
});

test("nDCG@k is 1 for the ideal order and lower when a grade-2 sits late", () => {
  assert.equal(ndcgAtK(["a", "b", "x"], rel, 3), 1);
  const swapped = ndcgAtK(["b", "a", "x"], rel, 3)!;
  assert.ok(swapped < 1 && swapped > 0.7);
  // hand check: gains 2^g-1 -> [1, 3]; dcg = 1/1 + 3/log2(3); ideal = 3/1 + 1/log2(3)
  const dcg = 1 + 3 / Math.log2(3);
  const ideal = 3 + 1 / Math.log2(3);
  assert.ok(Math.abs(swapped - dcg / ideal) < 1e-12);
  assert.equal(ndcgAtK(["x", "y", "z"], rel, 3), 0);
});

test("nDCG@k only counts the top k", () => {
  assert.equal(ndcgAtK(["x", "y", "z", "a"], { a: 2 }, 3), 0);
});

test("topLooksRelevant is true when the best score clears the threshold", () => {
  const ranked = [
    { datasetId: "a", score: 12 },
    { datasetId: "b", score: 3 },
  ];
  assert.equal(topLooksRelevant(ranked, 0), true);
  assert.equal(topLooksRelevant(ranked, 12), false); // strictly above
  assert.equal(topLooksRelevant(ranked, 11.9), true);
  assert.equal(topLooksRelevant([{ datasetId: "a", score: 0 }], 0), false);
  assert.equal(topLooksRelevant([], 0), false);
});

test("aggregate averages and ignores nulls", () => {
  assert.equal(aggregate([1, 0, null, 0.5]), 0.5);
  assert.equal(aggregate([]), null);
  assert.equal(aggregate([null]), null);
});
