import { test } from "node:test";
import assert from "node:assert/strict";

import {
  STATUS_OPTIONS,
  describeModel,
  statusPasses,
  toModel,
  toggleStatus,
} from "./status-filter";

test("toggleStatus adds a missing status and removes a present one", () => {
  assert.deepEqual(toggleStatus([], "VOIDED"), ["VOIDED"]);
  assert.deepEqual(toggleStatus(["VOIDED"], "CAPTURED"), [
    "VOIDED",
    "CAPTURED",
  ]);
  assert.deepEqual(toggleStatus(["VOIDED", "CAPTURED"], "VOIDED"), [
    "CAPTURED",
  ]);
});

test("toggleStatus does not mutate its input", () => {
  const selected = ["VOIDED"];
  toggleStatus(selected, "CAPTURED");
  assert.deepEqual(selected, ["VOIDED"]);
});

test("toModel is null for an empty selection", () => {
  assert.equal(toModel([]), null);
  assert.deepEqual(toModel(["PAID_OUT"]), { statuses: ["PAID_OUT"] });
});

test("statusPasses keeps only ticked statuses; no model keeps everything", () => {
  const model = toModel(["AUTHORIZED", "DISPUTED"]);
  assert.equal(statusPasses(model, "AUTHORIZED"), true);
  assert.equal(statusPasses(model, "CAPTURED"), false);
  assert.equal(statusPasses(model, undefined), false);
  assert.equal(statusPasses(model, 42), false);
  assert.equal(statusPasses(null, "CAPTURED"), true);
  assert.equal(statusPasses(null, undefined), true);
});

test("describeModel lists statuses in lifecycle order", () => {
  assert.equal(describeModel(null), "");
  assert.equal(
    describeModel({ statuses: ["VOIDED", "MATCHED", "ignored-unknown"] }),
    "MATCHED, VOIDED",
  );
});

test("the options are every escrow state", () => {
  assert.equal(STATUS_OPTIONS.length, 8);
  assert.ok(STATUS_OPTIONS.includes("PAID_OUT"));
});
