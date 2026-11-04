import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { deriveNeeds } from "./needs";

const SCHEMA = [
  "subject_key",
  "arm",
  "age_at_onset",
  "age_band",
  "sex",
  "onset_site",
  "baseline_alsfrs",
  "baseline_fvc_pct",
  "survival_months",
  "died",
];

describe("deriveNeeds", () => {
  it("picks columns whose words appear in the study", () => {
    const { needed } = deriveNeeds("Predict survival from baseline FVC and age at onset", SCHEMA);
    assert.ok(needed.includes("baseline_fvc_pct"));
    assert.ok(needed.includes("age_at_onset"));
    assert.ok(needed.includes("survival_months"));
    assert.ok(needed.includes("died"));
  });

  it("leaves out columns the study never mentions", () => {
    const { needed, notNeeded } = deriveNeeds("Compare survival by sex and age", SCHEMA);
    assert.ok(!needed.includes("baseline_fvc_pct"));
    assert.ok(notNeeded.includes("baseline_fvc_pct"));
    assert.ok(needed.includes("sex"));
  });

  it("uses plain-language aliases", () => {
    const { needed } = deriveNeeds("Does forced vital capacity decline predict death?", SCHEMA);
    assert.ok(needed.includes("baseline_fvc_pct"));
    assert.ok(needed.includes("died"));
  });

  it("never treats the subject key as a need", () => {
    const { needed } = deriveNeeds("subject key subject_key", SCHEMA);
    assert.ok(!needed.includes("subject_key"));
  });

  it("splits every column into exactly one list", () => {
    const { needed, notNeeded } = deriveNeeds("survival", SCHEMA);
    assert.equal(needed.length + notNeeded.length, SCHEMA.length);
  });

  it("handles empty and odd input", () => {
    assert.deepEqual(deriveNeeds("", SCHEMA).needed, []);
    assert.deepEqual(deriveNeeds("survival", []), { needed: [], notNeeded: [] });
    assert.deepEqual(deriveNeeds("   \u{1F600} ' OR 1=1 --", SCHEMA).needed, []);
  });
});

describe("types.ts", () => {
  it("stays type-only", () => {
    const src = readFileSync(new URL("./types.ts", import.meta.url), "utf8")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    assert.ok(!/\bimport\b/.test(src));
    assert.ok(!/node:/.test(src));
    assert.ok(!/^export (const|function|class|enum)/m.test(src));
  });
});
