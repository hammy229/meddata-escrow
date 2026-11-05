// BM25 offline scorer spec. Tiny hand-made catalogs, so each property is
// checked in isolation rather than through the real catalog.
import { test } from "node:test";
import assert from "node:assert/strict";

import { bm25Rank, searchTerms, stem } from "./matcher-bm25";
import type { CatalogEntry } from "./matcher";

function entry(
  id: string,
  title: string,
  description: string,
  tags: string[] = [],
): CatalogEntry {
  return { id, title, description, tags, recordCount: 1 };
}

test("stem folds plurals and leaves short words and -ss/-us/-is alone", () => {
  assert.equal(stem("inhalers"), "inhaler");
  assert.equal(stem("readmissions"), "readmission");
  assert.equal(stem("studies"), "study");
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("als"), "als");
  assert.equal(stem("class"), "class");
  assert.equal(stem("analysis"), "analysis");
  assert.equal(stem("virus"), "virus");
  assert.equal(stem("asthma"), "asthma");
});

test("searchTerms lowercases, drops filler and short tokens, keeps digits and hyphen parts", () => {
  assert.deepEqual(searchTerms("The Heart-Failure of 2 kids, with HbA1c!"), [
    "heart",
    "failure",
    "kid",
    "hba1c",
  ]);
  assert.deepEqual(searchTerms(""), []);
});

test("a plural in the study matches a singular in the listing", () => {
  const cat = [
    entry("a", "Inhaler use", "daily use"),
    entry("b", "Other", "x"),
  ];
  const [top] = bm25Rank("inhalers", cat);
  assert.equal(top.datasetId, "a");
  assert.ok(top.score > 0);
  assert.equal(top.rationale, "Matched on: inhalers");
});

test("a rare term outweighs a term every listing has", () => {
  const cat = [
    entry("common", "Synthetic data", "synthetic records"),
    entry("rare", "Asthma data", "synthetic asthma records"),
    entry("other", "Misc", "synthetic misc"),
  ];
  const ranked = bm25Rank("synthetic asthma", cat);
  assert.equal(ranked[0].datasetId, "rare");
  assert.ok(ranked[0].score > ranked[1].score);
});

test("a title hit beats the same word in the description", () => {
  const cat = [
    entry("desc", "Unrelated", "about asthma visits"),
    entry("title", "Asthma", "about visits"),
    entry("filler", "Other", "nothing here at all"),
  ];
  const ranked = bm25Rank("asthma", cat);
  assert.equal(ranked[0].datasetId, "title");
  assert.equal(ranked[1].datasetId, "desc");
});

test("a tag hit beats a description hit but not a title hit", () => {
  // Same field lengths everywhere, so only the field weights differ.
  const cat = [
    entry("desc", "Unrelated title", "about asthma visits", ["alpha", "beta"]),
    entry("tag", "Unrelated title", "about other visits", ["asthma", "beta"]),
    entry("title", "Asthma title", "about other visits", ["alpha", "beta"]),
  ];
  assert.deepEqual(
    bm25Rank("asthma", cat).map((m) => m.datasetId),
    ["title", "tag", "desc"],
  );
});

test("the shorter listing wins when both mention the term once", () => {
  const cat = [
    entry("long", "Study", "asthma " + "filler words pad the text ".repeat(20)),
    entry("short", "Study", "asthma visits"),
  ];
  assert.equal(bm25Rank("asthma", cat)[0].datasetId, "short");
});

test("repeating a word in the study does not change the ranking or score", () => {
  const cat = [entry("a", "Asthma", "asthma"), entry("b", "Copd", "copd")];
  assert.deepEqual(
    bm25Rank("asthma asthma asthma", cat),
    bm25Rank("asthma", cat),
  );
});

test("scores are numbers in [0, 100]; no overlap scores 0 with a plain rationale", () => {
  const cat = [
    entry("a", "Asthma", "asthma asthma asthma"),
    entry("b", "B", "b"),
  ];
  for (const q of ["asthma", "asthma copd kidney", "zzz", ""]) {
    for (const m of bm25Rank(q, cat)) {
      assert.equal(typeof m.score, "number");
      assert.ok(m.score >= 0 && m.score <= 100, `${q}: ${m.score}`);
      assert.equal(m.source, "keyword");
    }
  }
  const none = bm25Rank("zzz", cat);
  assert.ok(none.every((m) => m.score === 0));
  assert.equal(none[0].rationale, "No direct keyword overlap");
  assert.match(bm25Rank("asthma", cat)[0].rationale, /^Matched on: asthma$/);
});

test("words the catalog has never seen lower the score of a partial match", () => {
  const cat = [entry("a", "Asthma", "asthma"), entry("b", "Copd", "copd")];
  const full = bm25Rank("asthma", cat)[0].score;
  const diluted = bm25Rank("asthma xylophone", cat)[0].score;
  assert.ok(diluted < full);
  assert.ok(diluted > 0);
});

test("ties keep catalog order", () => {
  const cat = [entry("first", "Same", "same"), entry("second", "Same", "same")];
  assert.deepEqual(
    bm25Rank("same", cat).map((m) => m.datasetId),
    ["first", "second"],
  );
});

test("returns every listing exactly once, including for an empty catalog", () => {
  const cat = [entry("a", "A", "a"), entry("b", "B", "b")];
  assert.equal(bm25Rank("a", cat).length, 2);
  assert.deepEqual(bm25Rank("anything", []), []);
});

test("scores 2,000 listings quickly", () => {
  const cat = Array.from({ length: 2000 }, (_, i) =>
    entry(
      `d${i}`,
      `Title ${i % 17}`,
      `record set ${i % 31} for condition ${i % 53}`,
    ),
  );
  const t0 = performance.now();
  const ranked = bm25Rank("condition 7 record set", cat);
  assert.equal(ranked.length, 2000);
  assert.ok(performance.now() - t0 < 1000);
});

test("handles unicode, emoji and SQL-looking text without throwing", () => {
  const cat = [entry("a", "Asthma", "asthma")];
  for (const q of [
    "ásthma 😀",
    "'; DROP TABLE x; --",
    "\u0000\u0001",
    "a".repeat(10_000),
  ]) {
    assert.doesNotThrow(() => bm25Rank(q, cat));
  }
});
