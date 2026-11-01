import { test } from "node:test";
import assert from "node:assert/strict";

import { orderToView, workspaceUrl } from "./order-sync";

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
