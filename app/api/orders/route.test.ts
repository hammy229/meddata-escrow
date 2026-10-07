// Route input/transition validation — runs without PayPal credentials because
// every assertion here resolves before the PayPal client is built.
import { test } from "node:test";
import assert from "node:assert/strict";

import { POST, PATCH } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST rejects a missing/invalid amount with 422", async () => {
  const res = await POST(req({ datasetId: "ds_cardio_synthea_v1" }));
  assert.equal(res.status, 422);
});

test("PATCH rejects an unknown action with 422", async () => {
  const res = await PATCH(req({ action: "refund" }));
  assert.equal(res.status, 422);
});

test("PATCH authorize without orderId is 422", async () => {
  const res = await PATCH(req({ action: "authorize" }));
  assert.equal(res.status, 422);
});

test("PATCH capture from an illegal state is 409 (no charge attempted)", async () => {
  const res = await PATCH(req({ action: "capture", authorizationId: "AUTH-1", state: "MATCHED" }));
  assert.equal(res.status, 409);
});

test("PATCH authorize with valid input reaches PayPal and reports it unconfigured (503) without creds", async () => {
  const saved = { id: process.env.PAYPAL_CLIENT_ID, secret: process.env.PAYPAL_CLIENT_SECRET };
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  try {
    const res = await PATCH(req({ action: "authorize", orderId: "ORDER-1", state: "MATCHED" }));
    assert.equal(res.status, 503);
  } finally {
    if (saved.id) process.env.PAYPAL_CLIENT_ID = saved.id;
    if (saved.secret) process.env.PAYPAL_CLIENT_SECRET = saved.secret;
  }
});
