import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkEventsPerVariable } from "./power";

describe("checkEventsPerVariable", () => {
  it("fails below 5 events per variable", () => {
    assert.equal(checkEventsPerVariable(49, 10).severity, "fail");
    assert.equal(checkEventsPerVariable(0, 3).severity, "fail");
  });

  it("warns from 5 up to but not including 10", () => {
    assert.equal(checkEventsPerVariable(50, 10).severity, "warn");
    assert.equal(checkEventsPerVariable(99, 10).severity, "warn");
  });

  it("passes at 10 and above", () => {
    assert.equal(checkEventsPerVariable(100, 10).severity, "pass");
    assert.equal(checkEventsPerVariable(300, 4).severity, "pass");
  });

  it("is informational when there are no variables", () => {
    assert.equal(checkEventsPerVariable(100, 0).severity, "info");
  });

  it("shows event counts at or above the floor", () => {
    const f = checkEventsPerVariable(60, 8);
    assert.equal(f.metric?.events, 60);
    assert.equal(f.metric?.epv, 7.5);
  });

  it("hides small event counts and the ratio", () => {
    const f = checkEventsPerVariable(10, 1);
    assert.equal(f.severity, "pass");
    assert.equal(f.metric?.events, "fewer than 11");
    assert.ok(!("epv" in (f.metric ?? {})));
    assert.ok(!/\b10 events across/.test(f.reason));
    assert.match(f.reason, /fewer than 11 events/);
    assert.equal(checkEventsPerVariable(11, 1).metric?.events, 11);
  });
});
