import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateAlsCohort } from "../synth/als";
import { verdictOf } from "./common";
import { checkSubjectOverlap, checkSubjectUniqueness } from "./subjects";
import type { FitnessReport } from "./types";

const keys = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `SYN-${String(from + i).padStart(5, "0")}`);

describe("checkSubjectOverlap", () => {
  it("passes disjoint splits", () => {
    const f = checkSubjectOverlap({ train: keys(1, 100), test: keys(101, 150) });
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "pass");
  });

  it("fails shared subjects and reports a count", () => {
    const f = checkSubjectOverlap({ train: keys(1, 100), test: keys(51, 150) });
    assert.equal(f[0].severity, "fail");
    assert.equal(f[0].metric?.shared, 50);
  });

  it("renders a small overlap as fewer than 11", () => {
    const f = checkSubjectOverlap({ train: keys(1, 100), test: keys(98, 150) });
    assert.equal(f[0].severity, "fail");
    assert.equal(f[0].metric?.shared, "fewer than 11");
    assert.match(f[0].reason, /fewer than 11 subjects/);
  });

  it("never puts a subject key in the serialized report", () => {
    const c = generateAlsCohort({ seed: 5, variant: "clean", subjects: 80 });
    const all = c.subjects.map((s) => s.subject_key);
    const findings = [
      ...checkSubjectOverlap({ a: all.slice(0, 50), b: all.slice(40) }),
      ...checkSubjectOverlap({ a: all.slice(0, 50), b: all.slice(45) }),
      checkSubjectUniqueness([...all, all[0], all[1]]),
    ];
    const report: FitnessReport = {
      datasetId: "ds_test",
      stage: "delivery",
      synthetic: true,
      verdict: verdictOf(findings),
      findings,
      disclaimer: "screen, not proof",
      methodVersion: 1,
    };
    const text = JSON.stringify(report);
    assert.equal(report.verdict, "fail");
    for (const k of all) assert.ok(!text.includes(k), `leaked ${k}`);
    assert.ok(!text.includes("SYN-"));
  });

  it("handles empty and single splits", () => {
    assert.deepEqual(checkSubjectOverlap({}), []);
    assert.deepEqual(checkSubjectOverlap({ only: keys(1, 5) }), []);
    assert.equal(checkSubjectOverlap({ a: [], b: [] })[0].severity, "pass");
  });
});

describe("checkSubjectUniqueness", () => {
  it("passes unique keys and fails repeats", () => {
    assert.equal(checkSubjectUniqueness(keys(1, 20)).severity, "pass");
    const f = checkSubjectUniqueness([...keys(1, 20), ...keys(1, 15)]);
    assert.equal(f.severity, "fail");
    assert.equal(f.metric?.repeatedRows, 15);
    assert.equal(checkSubjectUniqueness([]).severity, "pass");
  });
});
