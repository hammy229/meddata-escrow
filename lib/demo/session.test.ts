import { test } from "node:test";
import assert from "node:assert/strict";

import { discardDemoSession, handleDemoRequest } from "./session";

let ip = 0;
// Each call gets its own IP so the per-IP reset limit (5/min) never trips.
function reset(body?: string, cookie?: string) {
  return handleDemoRequest(
    new Request("http://localhost/api/demo/session/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${++ip}`,
        ...(cookie ? { cookie } : {}),
      },
      ...(body !== undefined ? { body } : {}),
    }),
    ["reset"],
  );
}
const sessionOf = (res: Response) =>
  /meddata_walkthrough=([a-f0-9]{64})/.exec(
    res.headers.get("set-cookie") ?? "",
  )?.[1];
async function orderCount(id: string) {
  const res = await handleDemoRequest(
    new Request("http://localhost/api/demo/session/orders", {
      headers: { cookie: `meddata_walkthrough=${id}` },
    }),
    ["orders"],
  );
  assert.equal(res.status, 200);
  return ((await res.json()) as { orders: unknown[] }).orders.length;
}
async function inMockMode(fn: () => Promise<void>, mode = "mock") {
  const saved = process.env.PAYPAL_MODE;
  process.env.PAYPAL_MODE = mode;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.PAYPAL_MODE;
    else process.env.PAYPAL_MODE = saved;
  }
}

test("a plain reset and a story reset each start an isolated session", async () => {
  await inMockMode(async () => {
    const plain = await reset();
    assert.equal(plain.status, 200);
    const a = sessionOf(plain)!;
    assert.ok(a, "plain reset sets a session cookie");
    const story = await reset(JSON.stringify({ seed: "story" }));
    const b = sessionOf(story)!;
    try {
      assert.equal(story.status, 200);
      assert.notEqual(a, b);
      assert.equal(await orderCount(a), 0);
      assert.equal(await orderCount(b), 6);
      // Resetting B again with {} empties only B.
      assert.equal((await reset("{}", `meddata_walkthrough=${b}`)).status, 200);
      assert.equal(await orderCount(b), 0);
    } finally {
      discardDemoSession(a);
      discardDemoSession(b);
    }
  });
});

test("an unknown seed or a bad body is a 422 and starts nothing", async () => {
  await inMockMode(async () => {
    for (const body of [
      JSON.stringify({ seed: "nope" }),
      JSON.stringify({ seed: 5 }),
      JSON.stringify([]),
      "null",
      "not json",
    ]) {
      const res = await reset(body);
      assert.equal(res.status, 422, body);
      assert.equal(sessionOf(res), undefined, body);
    }
  });
});

test("the demo is off outside mock mode", async () => {
  for (const mode of ["", "live"]) {
    await inMockMode(async () => {
      assert.equal(
        (await reset(JSON.stringify({ seed: "story" }))).status,
        404,
      );
    }, mode);
  }
});

test("steps need a started session", async () => {
  await inMockMode(async () => {
    const res = await handleDemoRequest(
      new Request("http://localhost/api/demo/session/orders", {
        headers: { cookie: `meddata_walkthrough=${"0".repeat(64)}` },
      }),
      ["orders"],
    );
    assert.equal(res.status, 401);
  });
});
