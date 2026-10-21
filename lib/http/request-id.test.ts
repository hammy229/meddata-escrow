// Request id spec — sane incoming ids are reused, anything else is replaced
// with a fresh UUID.
import { test } from "node:test";
import assert from "node:assert/strict";

import { isSafeRequestId, resolveRequestId } from "./request-id";

const fixed = () => "generated-id";

test("reuses a sane incoming id", () => {
  for (const id of [
    "3f1c9e0a-7b2d-4c1e-9a8f-0123456789ab",
    "req_abc.123:xyz",
    "  padded-token-1  ",
  ]) {
    assert.equal(resolveRequestId(id, fixed), id.trim());
  }
});

test("replaces missing, short, long or unsafe ids", () => {
  for (const id of [
    null,
    undefined,
    "",
    "short",
    "x".repeat(129),
    "has space inside",
    "line\nbreak-injection",
    "<script>alert(1)</script>",
    "ünïcode-token",
  ]) {
    assert.equal(resolveRequestId(id, fixed), "generated-id");
  }
});

test("defaults to a random UUID", () => {
  const a = resolveRequestId(null);
  const b = resolveRequestId(null);
  assert.match(a, /^[0-9a-f-]{36}$/);
  assert.notEqual(a, b);
  assert.ok(isSafeRequestId(a));
});
