import { test } from "node:test";
import assert from "node:assert/strict";

import {
  describeHold,
  orderToView,
  shouldPoll,
  workspaceUrl,
} from "./order-sync";

test("shouldPoll stops on terminal states and unknowns", () => {
  for (const s of [
    "MATCHED",
    "AUTHORIZED",
    "DELIVERED",
    "CAPTURED",
    "DISPUTED",
  ])
    assert.equal(shouldPoll(s), true, s);
  for (const s of ["PAID_OUT", "VOIDED", "CANCELLED", "", null, undefined])
    assert.equal(shouldPoll(s), false, String(s));
});

const hold = (state: string, daysLeft: number) => ({
  state,
  daysLeft,
  honorUntil: "2026-11-04T10:00:00.000Z",
  expiresAt: "2026-11-30T10:00:00.000Z",
});

test("describeHold words the honor period", () => {
  assert.equal(
    describeHold(hold("honor", 28)),
    "Funds held · 28 days left · honor period ends Nov 4",
  );
});

test("describeHold says the guarantee ended once past honor", () => {
  assert.equal(
    describeHold(hold("valid", 10)),
    "Funds held · 10 days left · honor period ended Nov 4",
  );
});

test("describeHold uses singular for one day", () => {
  assert.match(describeHold(hold("valid", 1)) ?? "", /1 day left/);
});

test("describeHold flags an expired hold", () => {
  assert.equal(
    describeHold(hold("expired", 0)),
    "Hold expired · reauthorize before capturing",
  );
});

test("describeHold returns null without usable data", () => {
  assert.equal(describeHold(null), null);
  assert.equal(describeHold(undefined), null);
  assert.equal(describeHold({ state: "honor" }), null);
  assert.equal(describeHold("nope"), null);
  assert.equal(
    describeHold({ ...hold("honor", 3), honorUntil: "garbage" }),
    null,
  );
});

test("orderToView maps every escrow state", () => {
  const view = (escrow: string | null, flags: string[] = []) => ({
    escrow,
    voided: flags.includes("voided"),
    disputed: flags.includes("disputed"),
    cancelled: flags.includes("cancelled"),
  });
  assert.deepEqual(orderToView("MATCHED"), view("MATCHED"));
  assert.deepEqual(orderToView("AUTHORIZED"), view("AUTHORIZED"));
  assert.deepEqual(orderToView("DELIVERED"), view("DELIVERED"));
  assert.deepEqual(orderToView("CAPTURED"), view("CAPTURED"));
  assert.deepEqual(orderToView("PAID_OUT"), view("PAID_OUT"));
  assert.deepEqual(orderToView("DISPUTED"), view("AUTHORIZED", ["disputed"]));
  assert.deepEqual(orderToView("VOIDED"), view("AUTHORIZED", ["voided"]));
  assert.deepEqual(orderToView("CANCELLED"), view("MATCHED", ["cancelled"]));
});

test("a dispute keeps the delivered step when the page already showed it", () => {
  assert.equal(orderToView("DISPUTED", "DELIVERED").escrow, "DELIVERED");
  assert.equal(orderToView("DISPUTED", "MATCHED").escrow, "AUTHORIZED");
  assert.equal(orderToView("DISPUTED", null).escrow, "AUTHORIZED");
});

test("an unknown status shows nothing", () => {
  assert.deepEqual(orderToView("WHAT"), {
    escrow: null,
    voided: false,
    disputed: false,
    cancelled: false,
  });
});

test("workspaceUrl encodes the order id", () => {
  assert.equal(workspaceUrl("ord_123"), "/researcher?orderId=ord_123");
  assert.equal(workspaceUrl("a b&c"), "/researcher?orderId=a%20b%26c");
});
