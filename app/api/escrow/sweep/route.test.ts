import { test } from "node:test";
import assert from "node:assert/strict";

import { POST } from "./route";
import { withAgentDb } from "../../../../lib/agent/test-db";

function post(authorization?: string) {
  return POST(
    new Request("http://localhost/api/escrow/sweep", {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
  );
}

async function withSecret(value: string | undefined, fn: () => Promise<void>) {
  const saved = process.env.ESCROW_SWEEP_SECRET;
  if (value === undefined) delete process.env.ESCROW_SWEEP_SECRET;
  else process.env.ESCROW_SWEEP_SECRET = value;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.ESCROW_SWEEP_SECRET;
    else process.env.ESCROW_SWEEP_SECRET = saved;
  }
}

test("the sweep is off until a secret is configured", async () => {
  await withSecret(undefined, async () => {
    assert.equal((await post("Bearer anything")).status, 503);
  });
});

test("a wrong or missing secret is refused", async () => {
  await withSecret("right", async () => {
    assert.equal((await post()).status, 401);
    assert.equal((await post("Bearer wrong")).status, 401);
    assert.equal((await post("right")).status, 401);
  });
});

test(
  "the right secret runs the sweep",
  withAgentDb(async () => {
    await withSecret("right", async () => {
      const res = await post("Bearer right");
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        released: [],
        refunded: [],
        needsReview: [],
        failed: [],
      });
    });
  }),
);
