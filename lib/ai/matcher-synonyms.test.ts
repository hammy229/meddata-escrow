import { test } from "node:test";
import assert from "node:assert/strict";

import { CONCEPTS, synonymItems, synonymRank } from "./matcher-synonyms";
import { loadCatalog } from "./matcher";
import { searchTerms } from "./matcher-bm25";

test("a phrase is replaced by catalog words, with its weight shared", () => {
  const items = synonymItems("lou gehrig's disease progression");
  const stems = items.map((i) => i.stem);
  assert.ok(stems.includes("als"));
  assert.ok(stems.includes("sclerosis"));
  // the trigger words themselves no longer dilute the query
  assert.ok(!stems.includes("lou") && !stems.includes("gehrig"));
  // other words stay as plain items with weight 1
  assert.equal(items.find((i) => i.stem === "progression")?.weight, 1);
  // one concept counts as one word in total
  const concept = items.filter((i) =>
    ["als", "amyotrophic", "lateral", "sclerosis"].includes(i.stem),
  );
  const total = concept.reduce((a, i) => a + i.weight, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.ok(concept.every((i) => i.label === "lou gehrig"));
});

test("a query with no known phrase is unchanged", () => {
  const items = synonymItems("asthma inhalers");
  assert.deepEqual(
    items.map((i) => [i.stem, i.weight]),
    [
      ["asthma", 1],
      ["inhaler", 1],
    ],
  );
});

test("triggers match whole words only", () => {
  // "mind" must not trigger "mnd"; "classic" must not trigger anything via "class"
  const stems = synonymItems("mindful practice").map((i) => i.stem);
  assert.ok(!stems.includes("als"));
});

test("apostrophes and case do not matter", () => {
  const a = synonymItems("LOU GEHRIG'S")
    .map((i) => i.stem)
    .sort();
  const b = synonymItems("lou gehrigs")
    .map((i) => i.stem)
    .sort();
  assert.deepEqual(a, b);
  assert.ok(a.includes("als"));
});

test("every alias is a word that exists somewhere in the catalog", () => {
  // An alias the catalog never uses can never match; it would only dilute.
  const vocab = new Set(
    loadCatalog().flatMap((d) =>
      searchTerms(`${d.title} ${d.description} ${d.tags.join(" ")}`),
    ),
  );
  for (const c of CONCEPTS) {
    for (const a of c.aliases.flatMap(searchTerms)) {
      assert.ok(
        vocab.has(a),
        `${c.triggers[0]}: alias "${a}" is not in the catalog`,
      );
    }
  }
});

test("triggers are unique across concepts", () => {
  const seen = new Set<string>();
  for (const c of CONCEPTS) {
    for (const t of c.triggers) {
      assert.ok(!seen.has(t), `duplicate trigger ${t}`);
      seen.add(t);
    }
  }
});

test("synonymRank ranks by the translated query and keeps the contract", () => {
  const ranked = synonymRank("kids with wheezing", loadCatalog());
  assert.equal(ranked.length, loadCatalog().length);
  assert.equal(ranked[0].datasetId, "ds_asthma_pediatric_pilot_v1");
  assert.match(ranked[0].rationale, /^Matched on: /);
  assert.equal(ranked[0].source, "keyword");
  assert.ok(ranked.every((m) => m.score >= 0 && m.score <= 100));
});

test("empty and hostile input does not throw", () => {
  for (const q of [
    "",
    "   ",
    "'; DROP TABLE x; --",
    "😀".repeat(100),
    "a".repeat(50_000),
  ]) {
    assert.doesNotThrow(() => synonymRank(q, loadCatalog()));
  }
});

test("a concept counts once even if the study uses two of its phrases", () => {
  const items = synonymItems("glycemic control in type two diabetics");
  const diabetes = items.find((i) => i.stem === "diabete");
  assert.ok(diabetes);
  assert.ok(Math.abs(diabetes.weight - 1 / 3) < 1e-9);
});
