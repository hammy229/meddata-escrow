import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  checkPriceCents,
} from "./price-rules";

test("accepts whole cents inside the range, boundaries included", () => {
  for (const v of [MIN_PRICE_CENTS, 4900, MAX_PRICE_CENTS]) {
    assert.deepEqual(checkPriceCents(v), { ok: true, priceCents: v });
  }
});

test("rejects prices outside $1 to $10,000", () => {
  for (const v of [0, 99, MAX_PRICE_CENTS + 1, -500]) {
    assert.equal(checkPriceCents(v).ok, false, String(v));
  }
});

test("rejects fractional cents and non-numbers", () => {
  for (const v of [49.5, NaN, Infinity, "4900", null, undefined, {}, [4900]]) {
    const r = checkPriceCents(v);
    assert.equal(r.ok, false, String(v));
    if (!r.ok) assert.equal(typeof r.error, "string");
  }
});
