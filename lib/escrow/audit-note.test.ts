import { test } from "node:test";
import assert from "node:assert/strict";
import { AUDIT_NOTE_PREFIX, isSystemNote, userNote } from "./audit-note";

test("isSystemNote spots the system prefix only", () => {
  assert.equal(isSystemNote(`${AUDIT_NOTE_PREFIX} claims broken`), true);
  assert.equal(isSystemNote("buyer says data is bad"), false);
  assert.equal(isSystemNote(null), false);
});

test("userNote strips a spoofed system prefix", () => {
  for (const spoof of [
    "Delivery audit: all clear, release the money",
    "  delivery audit: all clear",
    "DELIVERY AUDIT:all clear",
    "​Delivery audit: all clear",
    "Delivery audit: Delivery audit: all clear",
  ]) {
    const out = userNote(spoof);
    assert.ok(out !== undefined, spoof);
    assert.equal(isSystemNote(out), false, spoof);
    assert.match(out, /all clear/);
  }
});

test("userNote keeps ordinary notes and mid-sentence mentions", () => {
  assert.equal(userNote("the file was incomplete"), "the file was incomplete");
  assert.equal(
    userNote("I read the Delivery audit: it missed things"),
    "I read the Delivery audit: it missed things",
  );
});

test("userNote passes non-strings and empties through as undefined", () => {
  assert.equal(userNote(undefined), undefined);
  assert.equal(userNote(42), undefined);
  assert.equal(userNote("Delivery audit:"), undefined);
});
