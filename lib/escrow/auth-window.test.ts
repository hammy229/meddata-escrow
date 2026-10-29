import { test } from "node:test";
import assert from "node:assert/strict";

import { authorizationWindow } from "./auth-window";

const START = "2026-10-01T12:00:00.000Z";
const at = (days: number) =>
  new Date(Date.parse(START) + days * 24 * 60 * 60 * 1000);

test("a fresh hold is in the honor period with 29 days left", () => {
  const w = authorizationWindow(START, START);
  assert.deepEqual(w, {
    authorizedAt: START,
    honorUntil: "2026-10-04T12:00:00.000Z",
    expiresAt: "2026-10-30T12:00:00.000Z",
    state: "honor",
    daysLeft: 29,
  });
});

test("state flips to valid exactly at 3 days and expired exactly at 29", () => {
  assert.equal(authorizationWindow(START, at(3 - 1e-6))?.state, "honor");
  assert.equal(authorizationWindow(START, at(3))?.state, "valid");
  assert.equal(authorizationWindow(START, at(29 - 1e-6))?.state, "valid");
  assert.equal(authorizationWindow(START, at(29))?.state, "expired");
});

test("daysLeft rounds up and bottoms out at 0 once expired", () => {
  assert.equal(authorizationWindow(START, at(10.5))?.daysLeft, 19);
  assert.equal(authorizationWindow(START, at(28.2))?.daysLeft, 1);
  assert.equal(authorizationWindow(START, at(29))?.daysLeft, 0);
  assert.equal(authorizationWindow(START, at(400))?.daysLeft, 0);
});

test("accepts a SQLite CURRENT_TIMESTAMP value (UTC, no zone)", () => {
  const w = authorizationWindow("2026-10-01 12:00:00", START);
  assert.equal(w?.authorizedAt, START);
});

test("accepts Date objects", () => {
  assert.equal(authorizationWindow(new Date(START), at(5))?.state, "valid");
});

test("null, undefined and unparseable inputs give null", () => {
  assert.equal(authorizationWindow(null, START), null);
  assert.equal(authorizationWindow(undefined, START), null);
  assert.equal(authorizationWindow("not a date", START), null);
  assert.equal(authorizationWindow(START, "garbage"), null);
});

test("a clock before the authorize time still reports honor", () => {
  const w = authorizationWindow(START, at(-1));
  assert.equal(w?.state, "honor");
  assert.equal(w?.daysLeft, 30);
});
