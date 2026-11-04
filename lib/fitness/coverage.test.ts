import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateAlsCohort } from "../synth/als";
import { checkCoverage, coveragePct } from "./coverage";
import { deriveNeeds } from "./needs";

const flawed = generateAlsCohort({ seed: 2, variant: "flawed" });
const clean = generateAlsCohort({ seed: 2, variant: "clean" });
const schema = Object.keys(flawed.subjects[0]);

describe("coveragePct", () => {
  it("counts null, undefined, empty string and NaN as missing", () => {
    const rows = [{ a: 1 }, { a: null }, { a: undefined }, { a: "" }, { a: Number.NaN }, { a: 0 }, { a: "x" }, { a: false }];
    assert.equal(coveragePct(rows, "a"), 50);
  });

  it("is 0 for no rows", () => {
    assert.equal(coveragePct([], "a"), 0);
  });
});

describe("checkCoverage", () => {
  it("gives no fail when low-coverage FVC is not needed", () => {
    const needs = deriveNeeds("Compare survival by sex and age", schema);
    const findings = checkCoverage(flawed.subjects, needs);
    assert.ok(!findings.some((f) => f.severity === "fail"));
    const fvc = findings.find((f) => f.column === "baseline_fvc_pct");
    assert.equal(fvc?.severity, "info");
  });

  it("fails when low-coverage FVC is needed", () => {
    const needs = deriveNeeds("Predict survival from baseline FVC", schema);
    const findings = checkCoverage(flawed.subjects, needs);
    const fvc = findings.find((f) => f.column === "baseline_fvc_pct");
    assert.equal(fvc?.severity, "fail");
  });

  it("passes the clean cohort even when FVC is needed", () => {
    const needs = deriveNeeds("Predict survival from baseline FVC", Object.keys(clean.subjects[0]));
    const findings = checkCoverage(clean.subjects, needs);
    assert.ok(findings.every((f) => f.severity === "pass"));
  });

  it("uses 50 and 80 percent as the fail and warn lines", () => {
    const make = (present: number) => Array.from({ length: 100 }, (_, i) => ({ x: i < present ? 1 : null }));
    const needs = { needed: ["x"], notNeeded: [] };
    assert.equal(checkCoverage(make(49), needs)[0].severity, "fail");
    assert.equal(checkCoverage(make(50), needs)[0].severity, "warn");
    assert.equal(checkCoverage(make(79), needs)[0].severity, "warn");
    assert.equal(checkCoverage(make(80), needs)[0].severity, "pass");
  });

  it("fails on an empty table and hides a small row count", () => {
    assert.equal(checkCoverage([], { needed: ["x"], notNeeded: [] })[0].severity, "fail");
    const f = checkCoverage([{ x: 1 }, { x: 2 }], { needed: ["x"], notNeeded: [] })[0];
    assert.equal(f.metric?.rows, "fewer than 11");
  });
});
