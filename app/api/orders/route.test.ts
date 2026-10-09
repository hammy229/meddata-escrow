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
  const res = await PATCH(
    req({ action: "capture", authorizationId: "AUTH-1", state: "MATCHED" }),
  );
  assert.equal(res.status, 409);
});

test("PATCH authorize with valid input reaches PayPal and reports it unconfigured (503) without creds", async () => {
  const saved = {
    id: process.env.PAYPAL_CLIENT_ID,
    secret: process.env.PAYPAL_CLIENT_SECRET,
  };
  delete process.env.PAYPAL_CLIENT_ID;
  delete process.env.PAYPAL_CLIENT_SECRET;
  try {
    const res = await PATCH(
      req({ action: "authorize", orderId: "ORDER-1", state: "MATCHED" }),
    );
    assert.equal(res.status, 503);
  } finally {
    if (saved.id) process.env.PAYPAL_CLIENT_ID = saved.id;
    if (saved.secret) process.env.PAYPAL_CLIENT_SECRET = saved.secret;
  }
});

// --- MOCK MODE (opt-in via PAYPAL_MODE=mock): creds-free escrow for the demo.
// Each test sets the flag and restores it in finally, like the 503 test above,
// so it never bleeds into the no-flag cases.
function withMockMode(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const saved = process.env.PAYPAL_MODE;
    process.env.PAYPAL_MODE = "mock";
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.PAYPAL_MODE;
      else process.env.PAYPAL_MODE = saved;
    }
  };
}

test(
  "POST in mock mode returns 201 with a mock orderId and MATCHED",
  withMockMode(async () => {
    const res = await POST(
      req({ datasetId: "ds_cardio_synthea_v1", amount: 42 }),
    );
    assert.equal(res.status, 201);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.mock, true);
    assert.equal(json.status, "CREATED");
    assert.equal(json.escrowState, "MATCHED");
    assert.match(String(json.orderId), /^MOCK-ORDER-/);
    assert.match(String(json.approveUrl), /checkoutnow\?token=MOCK-ORDER-/);
  }),
);

test(
  "PATCH authorize in mock mode: MATCHED -> AUTHORIZED with a mock authorizationId",
  withMockMode(async () => {
    const res = await PATCH(
      req({ action: "authorize", orderId: "MOCK-ORDER-1", state: "MATCHED" }),
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.mock, true);
    assert.equal(json.escrowState, "AUTHORIZED");
    assert.equal(json.status, "COMPLETED");
    assert.match(String(json.authorizationId), /^MOCK-AUTH-/);
  }),
);

test(
  "PATCH in mock mode drives the full legal arc to PAID_OUT",
  withMockMode(async () => {
    const authorize = await PATCH(
      req({ action: "authorize", orderId: "MOCK-ORDER-1", state: "MATCHED" }),
    );
    assert.equal(authorize.status, 200);
    assert.equal(
      ((await authorize.json()) as { escrowState: string }).escrowState,
      "AUTHORIZED",
    );

    const deliver = await PATCH(
      req({ action: "deliver", state: "AUTHORIZED" }),
    );
    assert.equal(deliver.status, 200);
    assert.equal(
      ((await deliver.json()) as { escrowState: string }).escrowState,
      "DELIVERED",
    );

    const capture = await PATCH(
      req({
        action: "capture",
        authorizationId: "MOCK-AUTH-1",
        state: "DELIVERED",
      }),
    );
    assert.equal(capture.status, 200);
    const capJson = (await capture.json()) as Record<string, unknown>;
    assert.equal(capJson.escrowState, "CAPTURED");
    assert.match(String(capJson.captureId), /^MOCK-CAP-/);

    const payout = await PATCH(req({ action: "payout", state: "CAPTURED" }));
    assert.equal(payout.status, 200);
    const payoutJson = (await payout.json()) as Record<string, unknown>;
    assert.equal(payoutJson.escrowState, "PAID_OUT");
    assert.equal(payoutJson.status, "PENDING");
    assert.match(String(payoutJson.payoutBatchId), /^MOCK-PAYOUT-/);
  }),
);

test(
  "PATCH in mock mode: void from AUTHORIZED reaches VOIDED",
  withMockMode(async () => {
    const res = await PATCH(
      req({
        action: "void",
        authorizationId: "MOCK-AUTH-1",
        state: "AUTHORIZED",
      }),
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as Record<string, unknown>;
    assert.equal(json.mock, true);
    assert.equal(json.escrowState, "VOIDED");
  }),
);

test(
  "PATCH in mock mode: an illegal transition is still 409 (no PayPal reached)",
  withMockMode(async () => {
    const res = await PATCH(
      req({
        action: "capture",
        authorizationId: "MOCK-AUTH-1",
        state: "MATCHED",
      }),
    );
    assert.equal(res.status, 409);
  }),
);
