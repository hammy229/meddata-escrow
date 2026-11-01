import { test } from "node:test";
import assert from "node:assert/strict";

import { ESCROW_STATES, can } from "../escrow/state-machine";
import { needsAction, vendorActionsFor } from "./vendor-actions";

test("only disputed orders can be released or refunded", () => {
  for (const state of ESCROW_STATES) {
    const ids = vendorActionsFor(state).map((a) => a.id);
    assert.deepEqual(
      ids,
      state === "DISPUTED" ? ["release", "refund"] : [],
      state,
    );
  }
});

test("every offered action is legal in the state machine", () => {
  for (const state of ESCROW_STATES) {
    for (const a of vendorActionsFor(state)) {
      const event =
        a.resolution === "capture" ? "RESOLVE_CAPTURE" : "RESOLVE_VOID";
      assert.ok(can(state, event), `${a.id} from ${state}`);
    }
  }
});

test("release captures and refund voids", () => {
  const [release, refund] = vendorActionsFor("DISPUTED");
  assert.equal(release.resolution, "capture");
  assert.equal(refund.resolution, "void");
  assert.equal(release.action, "resolve");
});

test("unknown or missing status offers nothing", () => {
  assert.deepEqual(vendorActionsFor("WHATEVER"), []);
  assert.deepEqual(vendorActionsFor(undefined), []);
  assert.equal(needsAction(null), false);
});

test("needsAction matches having actions", () => {
  for (const state of ESCROW_STATES) {
    assert.equal(needsAction(state), vendorActionsFor(state).length > 0);
  }
});
