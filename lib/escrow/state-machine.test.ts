// Escrow state-machine spec. Covers every allowed transition plus
// representative illegal moves and terminal-state rejection.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  transition,
  can,
  isTerminal,
  isEscrowState,
  grantsDataAccess,
  ESCROW_STATES,
  InvalidTransitionError,
  type EscrowState,
  type EscrowEvent,
} from "./state-machine";

// Every allowed transition: [from, event, to]
const ALLOWED: ReadonlyArray<[EscrowState, EscrowEvent, EscrowState]> = [
  ["MATCHED", "AUTHORIZE", "AUTHORIZED"],
  ["MATCHED", "CANCEL", "CANCELLED"],
  ["AUTHORIZED", "DELIVER", "DELIVERED"],
  ["AUTHORIZED", "VOID", "VOIDED"],
  ["AUTHORIZED", "DISPUTE", "DISPUTED"],
  ["DELIVERED", "CAPTURE", "CAPTURED"],
  ["DELIVERED", "DISPUTE", "DISPUTED"],
  ["CAPTURED", "PAYOUT", "PAID_OUT"],
  ["DISPUTED", "RESOLVE_CAPTURE", "CAPTURED"],
  ["DISPUTED", "RESOLVE_VOID", "VOIDED"],
];

for (const [from, event, to] of ALLOWED) {
  test(`${from} --${event}--> ${to}`, () => {
    assert.equal(transition(from, event), to);
    assert.equal(can(from, event), true);
  });
}

// Representative illegal moves: [from, event]
const ILLEGAL: ReadonlyArray<[EscrowState, EscrowEvent]> = [
  ["MATCHED", "CAPTURE"], // cannot capture before authorize+deliver
  ["AUTHORIZED", "CAPTURE"], // must deliver first
  ["AUTHORIZED", "PAYOUT"],
  ["DELIVERED", "VOID"], // delivered goods: dispute, don't silently void
  ["CAPTURED", "VOID"],
  ["DISPUTED", "DELIVER"],
];

for (const [from, event] of ILLEGAL) {
  test(`${from} --${event}--> rejected`, () => {
    assert.throws(() => transition(from, event), InvalidTransitionError);
    assert.equal(can(from, event), false);
  });
}

// Terminal states reject every event.
const TERMINALS: ReadonlyArray<EscrowState> = [
  "PAID_OUT",
  "VOIDED",
  "CANCELLED",
];
const EVERY_EVENT: ReadonlyArray<EscrowEvent> = [
  "AUTHORIZE",
  "DELIVER",
  "CAPTURE",
  "PAYOUT",
  "DISPUTE",
  "RESOLVE_CAPTURE",
  "RESOLVE_VOID",
  "VOID",
  "CANCEL",
];

for (const state of TERMINALS) {
  test(`${state} is terminal and rejects all events`, () => {
    assert.equal(isTerminal(state), true);
    for (const event of EVERY_EVENT) {
      assert.equal(can(state, event), false);
      assert.throws(() => transition(state, event), InvalidTransitionError);
    }
  });
}

test("non-terminal states report isTerminal=false", () => {
  for (const state of [
    "MATCHED",
    "AUTHORIZED",
    "DELIVERED",
    "CAPTURED",
    "DISPUTED",
  ] as EscrowState[]) {
    assert.equal(isTerminal(state), false);
  }
});

test("ESCROW_STATES lists all eight canonical states", () => {
  assert.equal(ESCROW_STATES.length, 8);
  for (const state of [
    "MATCHED",
    "AUTHORIZED",
    "DELIVERED",
    "CAPTURED",
    "PAID_OUT",
    "DISPUTED",
    "VOIDED",
    "CANCELLED",
  ] as EscrowState[]) {
    assert.ok(ESCROW_STATES.includes(state), `missing ${state}`);
  }
});

test("isEscrowState accepts known states and rejects anything else", () => {
  assert.equal(isEscrowState("DISPUTED"), true);
  assert.equal(isEscrowState("REFUNDED"), false);
  assert.equal(isEscrowState(""), false);
  assert.equal(isEscrowState(42), false);
  assert.equal(isEscrowState(undefined), false);
});

test("grantsDataAccess only for delivered-and-later, non-disputed states", () => {
  for (const state of ["DELIVERED", "CAPTURED", "PAID_OUT"] as EscrowState[]) {
    assert.equal(grantsDataAccess(state), true, state);
  }
  for (const state of [
    "MATCHED",
    "AUTHORIZED",
    "DISPUTED",
    "VOIDED",
    "CANCELLED",
  ] as EscrowState[]) {
    assert.equal(grantsDataAccess(state), false, state);
  }
});
