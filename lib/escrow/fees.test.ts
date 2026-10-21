import { test } from "node:test";
import assert from "node:assert/strict";

import { PLATFORM_FEE_BPS, platformFeeCents, vendorPayoutCents } from "./fees";

test("the platform fee is 10% and vendor + fee always equals the amount", () => {
  assert.equal(PLATFORM_FEE_BPS, 1000);
  assert.equal(platformFeeCents(4900), 490);
  assert.equal(vendorPayoutCents(4900), 4410);
  for (const cents of [1, 5, 99, 4999, 123457]) {
    assert.equal(vendorPayoutCents(cents) + platformFeeCents(cents), cents);
  }
});
