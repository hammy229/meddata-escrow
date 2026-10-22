// Mock-mode helpers spec: id shape and the PAYPAL_MODE opt-in gate.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { mockId, isMockMode } from "./ids";

const saved = process.env.PAYPAL_MODE;
afterEach(() => {
  if (saved === undefined) delete process.env.PAYPAL_MODE;
  else process.env.PAYPAL_MODE = saved;
});

test("mockId is the prefix plus an 8-char hex suffix", () => {
  assert.match(mockId("MOCK-ORDER"), /^MOCK-ORDER-[0-9a-f]{8}$/);
});

test("mockId does not repeat across calls", () => {
  const ids = new Set(Array.from({ length: 200 }, () => mockId("X")));
  assert.equal(ids.size, 200);
});

test("isMockMode is true only for PAYPAL_MODE=mock", () => {
  process.env.PAYPAL_MODE = "mock";
  assert.equal(isMockMode(), true);

  for (const value of ["sandbox", "live", "MOCK", ""]) {
    process.env.PAYPAL_MODE = value;
    assert.equal(isMockMode(), false, `PAYPAL_MODE=${value}`);
  }

  delete process.env.PAYPAL_MODE;
  assert.equal(isMockMode(), false);
});
