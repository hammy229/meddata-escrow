import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateAlsCohort } from "../synth/als";
import { categoricalPsi, checkDrift, numericPsi, psi } from "./drift";

const als = (variant: "clean" | "flawed", seed: number, subjects = 400) =>
  generateAlsCohort({ seed, variant, subjects }).subjects;

describe("psi", () => {
  it("is zero for identical shares", () => {
    assert.equal(psi([0.5, 0.5], [0.5, 0.5]), 0);
  });
  it("matches a hand computed value", () => {
    // (0.6-0.5)*ln(1.2) + (0.4-0.5)*ln(0.8)
    const want = 0.1 * Math.log(1.2) + -0.1 * Math.log(0.8);
    assert.ok(Math.abs(psi([0.5, 0.5], [0.6, 0.4]) - want) < 1e-12);
  });
  it("stays finite when a bin is empty", () => {
    const v = psi([0.5, 0.5, 0], [0.5, 0, 0.5]);
    assert.ok(Number.isFinite(v) && v > 0.25);
  });
  it("gives 0 for identical numeric and categorical data", () => {
    const xs = Array.from({ length: 200 }, (_, i) => (i * 37) % 101);
    assert.equal(numericPsi(xs, xs), 0);
    assert.equal(categoricalPsi(["a", "b", "a"], ["a", "b", "a"]), 0);
  });
  it("is large for a shifted numeric column and returns null on empty input", () => {
    const xs = Array.from({ length: 300 }, (_, i) => i);
    assert.ok((numericPsi(xs, xs.map((x) => x + 150)) ?? 0) > 0.25);
    assert.equal(numericPsi([], xs), null);
    assert.equal(categoricalPsi([], ["a"]), null);
  });
});

describe("checkDrift", () => {
  it("passes identical data with zero PSI", () => {
    const rows = als("clean", 3);
    const f = checkDrift(rows, rows, { ignore: ["subject_key"] });
    assert.deepEqual(f.map((x) => x.severity), ["pass"]);
  });

  it("does not fire on two clean draws of the same process", () => {
    const f = checkDrift(als("clean", 3), als("clean", 20), { ignore: ["subject_key"] });
    assert.deepEqual(f.map((x) => x.severity), ["pass"], JSON.stringify(f));
  });

  it("flags an added column", () => {
    const f = checkDrift(als("clean", 3), als("flawed", 3), { ignore: ["subject_key"] });
    assert.ok(f.some((x) => x.column === "last_contact_alsfrs" && /added/.test(x.title)));
  });

  it("flags a removed column", () => {
    const sample = als("flawed", 3);
    const delivery = als("flawed", 4).map((r) => {
      const { last_contact_alsfrs: _drop, ...rest } = r;
      void _drop;
      return rest;
    });
    const f = checkDrift(sample, delivery);
    assert.ok(f.some((x) => x.column === "last_contact_alsfrs" && /removed/.test(x.title)));
  });

  it("flags a missingness jump", () => {
    const f = checkDrift(als("clean", 20), als("flawed", 34));
    const m = f.find((x) => x.column === "baseline_fvc_pct" && /missingness/.test(x.title));
    assert.ok(m);
    assert.ok((m.metric?.deliveryMissingPct as number) > 60);
  });

  it("flags a shifted numeric column and a shifted category, warn only", () => {
    const sample = als("clean", 3);
    const delivery = sample.map((r) => ({ ...r, age_at_onset: r.age_at_onset + 12, sex: "M" }));
    const f = checkDrift(sample, delivery, { ignore: ["subject_key"] });
    const age = f.find((x) => x.column === "age_at_onset");
    const sex = f.find((x) => x.column === "sex");
    assert.ok(age && sex);
    assert.ok((age.metric?.psi as number) >= 0.25);
    assert.ok((sex.metric?.psi as number) >= 0.1);
    assert.ok(f.every((x) => x.severity === "warn" || x.severity === "pass"));
  });

  it("says why it did not run on tiny tables, and shows no rows", () => {
    const f = checkDrift(als("clean", 3, 10), als("clean", 4, 10));
    assert.equal(f.length, 1);
    assert.equal(f[0].severity, "info");
    assert.match(f[0].reason, /fewer than/);
    const text = JSON.stringify(checkDrift(als("clean", 3), als("flawed", 9)));
    assert.doesNotMatch(text, /SYN-\d/);
  });
});
