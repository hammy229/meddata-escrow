// Outbound escrow-transition webhook spec. Injected fetch only — no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";

import {
  emitEscrowTransition,
  signOutboundBody,
  SIGNATURE_HEADER,
  type EscrowTransition,
} from "./outbound";

const T: EscrowTransition = {
  orderId: "ord_1",
  event: "CAPTURE",
  from: "DELIVERED",
  to: "CAPTURED",
  amountCents: 4900,
  datasetId: "ds_1",
  at: "2026-10-21T12:00:00.000Z",
};

function recorder(response: () => Promise<Response> | Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    return response();
  }) as typeof fetch;
  return { fn, calls };
}

test("posts the transition with a verifiable HMAC signature", async () => {
  const { fn, calls } = recorder(() => new Response(null, { status: 200 }));
  await emitEscrowTransition(T, {
    url: "https://hooks.example/catch",
    secret: "s3cret",
    fetch: fn,
  });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, "https://hooks.example/catch");
  assert.equal(init.method, "POST");
  const body = String(init.body);
  assert.deepEqual(JSON.parse(body), { type: "escrow.transition", ...T });

  // A receiver recomputes the HMAC over the raw body and compares.
  const sig = (init.headers as Record<string, string>)[SIGNATURE_HEADER];
  const expected = `sha256=${createHmac("sha256", "s3cret").update(body).digest("hex")}`;
  assert.ok(timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  assert.equal(signOutboundBody(body, "s3cret"), expected);
  assert.ok(init.signal instanceof AbortSignal, "has a timeout signal");
});

test("is a no-op when OUTBOUND_WEBHOOK_URL is unset", async () => {
  const saved = process.env.OUTBOUND_WEBHOOK_URL;
  delete process.env.OUTBOUND_WEBHOOK_URL;
  try {
    const { fn, calls } = recorder(() => new Response(null));
    await emitEscrowTransition(T, { fetch: fn });
    assert.equal(calls.length, 0);
  } finally {
    if (saved !== undefined) process.env.OUTBOUND_WEBHOOK_URL = saved;
  }
});

test("omits the signature header when no secret is configured", async () => {
  const saved = process.env.OUTBOUND_WEBHOOK_SECRET;
  delete process.env.OUTBOUND_WEBHOOK_SECRET;
  try {
    const { fn, calls } = recorder(() => new Response(null));
    await emitEscrowTransition(T, { url: "https://hooks.example", fetch: fn });
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers[SIGNATURE_HEADER], undefined);
  } finally {
    if (saved !== undefined) process.env.OUTBOUND_WEBHOOK_SECRET = saved;
  }
});

test("swallows network errors, non-2xx responses, and timeouts", async () => {
  const url = "https://hooks.example";
  const boom = recorder(() => Promise.reject(new TypeError("fetch failed")));
  await emitEscrowTransition(T, { url, fetch: boom.fn });

  const rejected = recorder(() => new Response("no", { status: 500 }));
  await emitEscrowTransition(T, { url, fetch: rejected.fn });

  // A receiver that never answers is cut off by the timeout signal.
  const hang = (async (_u: string | URL, init: RequestInit = {}) =>
    new Promise<Response>((_, reject) =>
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason)),
    )) as typeof fetch;
  const started = Date.now();
  await emitEscrowTransition(T, { url, fetch: hang, timeoutMs: 20 });
  assert.ok(Date.now() - started < 2000);
});
