import { test } from "node:test";
import assert from "node:assert/strict";

import { ESCROW_STATES, can } from "../escrow/state-machine";
import { needsAction, vendorActionsFor } from "./vendor-actions";

test("only legal actions are offered in each state", () => {
  for (const state of ESCROW_STATES) {
    const ids = vendorActionsFor(state).map((a) => a.id);
    assert.deepEqual(
      ids,
      state === "DISPUTED"
        ? ["refund"]
        : state === "AUTHORIZED"
          ? ["deliver"]
          : state === "CAPTURED"
            ? ["payout"]
            : [],
      state,
    );
  }
});

test("every offered action is legal in the state machine", () => {
  for (const state of ESCROW_STATES) {
    for (const a of vendorActionsFor(state)) {
      const event =
        a.id === "deliver"
          ? "DELIVER"
          : a.id === "payout"
            ? "PAYOUT"
            : "RESOLVE_VOID";
      assert.ok(can(state, event), `${a.id} from ${state}`);
    }
  }
});

test("a vendor can only settle a dispute by refunding the buyer", () => {
  const actions = vendorActionsFor("DISPUTED");
  assert.deepEqual(
    actions.map((a) => [a.action, a.resolution]),
    [["resolve", "void"]],
  );
  assert.equal(vendorActionsFor("AUTHORIZED")[0].action, "deliver");
  assert.equal(vendorActionsFor("AUTHORIZED")[0].resolution, undefined);
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
