import { test } from "node:test";
import assert from "node:assert/strict";

import { offerView, parseSplit } from "./split";

test("a valid figure splits the whole price", () => {
  assert.deepEqual(parseSplit("30.50", 4900), {
    ok: true,
    captureCents: 3050,
    refundCents: 1850,
  });
});

test("a split must leave money on both sides", () => {
  for (const bad of ["", "0", "abc", "-5", "0.001", "49", "60"])
    assert.equal(parseSplit(bad, 4900).ok, false, bad);
});

test("an offer reads differently to each side", () => {
  const order = {
    amount_cents: 4900,
    split_offer_cents: 3000,
    split_offer_by: "vendor",
  };
  assert.equal(offerView(order, "vendor").kind, "mine");
  assert.deepEqual(offerView(order, "researcher"), {
    kind: "theirs",
    captureCents: 3000,
    refundCents: 1900,
  });
  assert.deepEqual(offerView({ amount_cents: 4900 }, "vendor"), {
    kind: "none",
  });
});
