import { test } from "node:test";
import assert from "node:assert/strict";

import { escrowRequest } from "./escrow-response";

const reply = (status: number, body: unknown): typeof fetch =>
  (async () =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
    })) as typeof fetch;

const init: RequestInit = { method: "PATCH" };

test("a 2xx response is ok and carries the parsed body", async () => {
  const out = await escrowRequest(
    "/api/orders",
    init,
    reply(200, { escrowState: "AUTHORIZED" }),
  );
  assert.deepEqual(out, {
    kind: "ok",
    status: 200,
    data: { escrowState: "AUTHORIZED" },
  });
});

test("4xx and 5xx surface the server's own error message", async () => {
  for (const status of [400, 404, 409, 422, 500, 502]) {
    const out = await escrowRequest(
      "/api/orders",
      init,
      reply(status, { error: "invalid transition: CAPTURED -> VOIDED" }),
    );
    assert.deepEqual(out, {
      kind: "error",
      status,
      message: "invalid transition: CAPTURED -> VOIDED",
    });
  }
});

test("an error without a readable message still fails, with the status", async () => {
  for (const body of ["<html>bad gateway</html>", {}, { error: "  " }]) {
    const out = await escrowRequest("/api/orders", init, reply(502, body));
    assert.deepEqual(out, {
      kind: "error",
      status: 502,
      message: "The escrow service responded 502.",
    });
  }
});

test("a 2xx with an unreadable body is still ok, with empty data", async () => {
  const out = await escrowRequest("/api/orders", init, reply(200, "not json"));
  assert.deepEqual(out, { kind: "ok", status: 200, data: {} });
});

test("only a thrown fetch counts as offline", async () => {
  const out = await escrowRequest("/api/orders", init, (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch);
  assert.deepEqual(out, { kind: "offline" });
});

test("passes the url and init straight through", async () => {
  let seen: [unknown, unknown] = [null, null];
  await escrowRequest("/api/orders", init, (async (u: unknown, i: unknown) => {
    seen = [u, i];
    return new Response("{}");
  }) as typeof fetch);
  assert.deepEqual(seen, ["/api/orders", init]);
});
