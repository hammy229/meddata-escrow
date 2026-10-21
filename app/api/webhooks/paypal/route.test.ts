// PayPal webhook receiver spec. Isolated temp-file DB per test. Verification
// runs either in mock mode (x-mock-webhook: 1) or in real mode against a
// stubbed global fetch standing in for PayPal — never the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { POST } from "./route";
import {
  openDb,
  createOrder,
  getOrder,
  listOrderEvents,
  type NewOrder,
} from "../../../../lib/db/client";

const DATASET_ID = "ds_webhook_test";
const ENV_KEYS = [
  "DATABASE_URL",
  "PAYPAL_MODE",
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
] as const;

function withEnv(
  fn: (ctx: { url: string }) => Promise<void>,
  env: Partial<Record<(typeof ENV_KEYS)[number], string>> = {
    PAYPAL_MODE: "mock",
  },
): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-webhook-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    Object.assign(process.env, env, { DATABASE_URL: url });
    const db = openDb(url);
    db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
      "vnd_wh",
      "Webhook Vendor",
    );
    db.prepare(
      `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
    ).run(DATASET_ID, "vnd_wh", "Webhook Cohort", 4900);
    db.close();
    try {
      await fn({ url });
    } finally {
      for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      rmSync(path, { force: true });
    }
  };
}

function seedOrder(url: string, overrides: Partial<NewOrder> = {}) {
  const db = openDb(url);
  const order = createOrder(db, {
    datasetId: DATASET_ID,
    buyerEmail: "b@example.com",
    amountCents: 4900,
    paypalOrderId: "PP-ORDER-1",
    authorizationId: "AUTH-1",
    status: "AUTHORIZED",
    ...overrides,
  });
  db.close();
  return order;
}

function webhook(
  event: Record<string, unknown>,
  headers: Record<string, string> = { "x-mock-webhook": "1" },
) {
  return new Request("http://localhost/api/webhooks/paypal", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(event),
  });
}

const voided = (id = "WH-VOID-1") => ({
  id,
  event_type: "PAYMENT.AUTHORIZATION.VOIDED",
  resource: { id: "AUTH-1", status: "VOIDED" },
});

test(
  "a verified AUTHORIZATION.VOIDED voids an AUTHORIZED order with an audit note",
  withEnv(async ({ url }) => {
    const order = seedOrder(url);
    const res = await POST(webhook(voided()));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      received: true,
      applied: "VOID",
      orderId: order.id,
      escrowState: "VOIDED",
    });
    const db = openDb(url);
    assert.equal(getOrder(db, order.id)?.status, "VOIDED");
    const last = listOrderEvents(db, order.id).at(-1);
    assert.equal(last?.event, "VOID");
    assert.equal(last?.note, "via PayPal webhook PAYMENT.AUTHORIZATION.VOIDED");
    db.close();
  }),
);

test(
  "CAPTURE.COMPLETED links back via related_ids.authorization_id",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { status: "DELIVERED" });
    const res = await POST(
      webhook({
        id: "WH-CAP-1",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-9",
          supplementary_data: { related_ids: { authorization_id: "AUTH-1" } },
        },
      }),
    );
    assert.equal(
      ((await res.json()) as { applied: string }).applied,
      "CAPTURE",
    );
    assert.equal(getOrder(openDb(url), order.id)?.status, "CAPTURED");
  }),
);

test(
  "a bad or missing signature is 401 and changes nothing",
  withEnv(async ({ url }) => {
    const order = seedOrder(url);
    const res = await POST(webhook(voided(), {}));
    assert.equal(res.status, 401);
    assert.equal(getOrder(openDb(url), order.id)?.status, "AUTHORIZED");
  }),
);

test(
  "real mode: PayPal FAILURE is 401, SUCCESS is processed",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url);
      const realFetch = globalThis.fetch;
      let verdict = "FAILURE";
      const sent: unknown[] = [];
      globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
        const u = String(input);
        if (u.endsWith("/v1/oauth2/token"))
          return Response.json({ access_token: "tok", expires_in: 3600 });
        if (u.endsWith("/v1/notifications/verify-webhook-signature")) {
          sent.push(JSON.parse(String(init?.body)));
          return Response.json({ verification_status: verdict });
        }
        throw new Error(`unexpected fetch ${u}`);
      }) as typeof fetch;
      const signed = {
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api.sandbox.paypal.com/certs/C",
        "paypal-transmission-id": "tx-1",
        "paypal-transmission-sig": "sig",
        "paypal-transmission-time": "2026-10-21T00:00:00Z",
      };
      try {
        // The mock header is meaningless outside mock mode.
        const forged = await POST(
          webhook(voided(), { ...signed, "x-mock-webhook": "1" }),
        );
        assert.equal(forged.status, 401);
        assert.equal(getOrder(openDb(url), order.id)?.status, "AUTHORIZED");

        verdict = "SUCCESS";
        const ok = await POST(webhook(voided(), signed));
        assert.equal(ok.status, 200);
        assert.equal(getOrder(openDb(url), order.id)?.status, "VOIDED");
        assert.equal(
          (sent[1] as { webhook_id: string }).webhook_id,
          "WH-ID-TEST",
        );
      } finally {
        globalThis.fetch = realFetch;
      }
    },
    {
      PAYPAL_CLIENT_ID: "cid",
      PAYPAL_CLIENT_SECRET: "secret",
      PAYPAL_WEBHOOK_ID: "WH-ID-TEST",
    },
  ),
);

test(
  "real mode without PAYPAL_WEBHOOK_ID rejects every webhook (401)",
  withEnv(
    async ({ url }) => {
      seedOrder(url);
      const res = await POST(webhook(voided(), {}));
      assert.equal(res.status, 401);
    },
    { PAYPAL_CLIENT_ID: "cid", PAYPAL_CLIENT_SECRET: "secret" },
  ),
);

test(
  "a replayed event id returns { duplicate: true } and does nothing",
  withEnv(async ({ url }) => {
    const order = seedOrder(url);
    await POST(webhook(voided("WH-SAME")));
    const db = openDb(url);
    const eventsBefore = listOrderEvents(db, order.id).length;
    db.close();

    const replay = await POST(webhook(voided("WH-SAME")));
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { duplicate: true });
    assert.equal(listOrderEvents(openDb(url), order.id).length, eventsBefore);
  }),
);

test(
  "an event that is not legal from the current state is ignored (no forced move)",
  withEnv(async ({ url }) => {
    const captured = seedOrder(url, { status: "CAPTURED" });
    const res = await POST(
      webhook({
        id: "WH-CAP-AGAIN",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        resource: {
          id: "CAP-1",
          supplementary_data: { related_ids: { authorization_id: "AUTH-1" } },
        },
      }),
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { ignored: boolean };
    assert.equal(json.ignored, true);
    assert.equal(getOrder(openDb(url), captured.id)?.status, "CAPTURED");
    assert.equal(listOrderEvents(openDb(url), captured.id).length, 1);
  }),
);

test(
  "an event for an unknown order is ignored with 200",
  withEnv(async () => {
    const res = await POST(
      webhook({
        ...voided("WH-ORPHAN"),
        resource: { id: "AUTH-NOBODY" },
      }),
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ignored: true,
      reason: "no matching order",
    });
  }),
);

test(
  "an unknown event type is ignored with 200",
  withEnv(async () => {
    const res = await POST(
      webhook({ id: "WH-X", event_type: "CHECKOUT.ORDER.APPROVED" }),
    );
    assert.equal(res.status, 200);
    assert.equal(((await res.json()) as { ignored: boolean }).ignored, true);
  }),
);

test(
  "DISPUTE.CREATED disputes a DELIVERED order; PAYOUTSBATCH.SUCCESS is record-only",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { status: "DELIVERED" });
    const disputed = await POST(
      webhook({
        id: "WH-DISP-1",
        event_type: "CUSTOMER.DISPUTE.CREATED",
        resource: {
          dispute_id: "PP-D-1",
          disputed_transactions: [{ seller_transaction_id: "AUTH-1" }],
        },
      }),
    );
    assert.equal(
      ((await disputed.json()) as { applied: string }).applied,
      "DISPUTE",
    );
    assert.equal(getOrder(openDb(url), order.id)?.status, "DISPUTED");

    const db = openDb(url);
    const paid = createOrder(db, {
      datasetId: DATASET_ID,
      buyerEmail: "b@example.com",
      amountCents: 4900,
      status: "PAID_OUT",
    });
    db.prepare(`UPDATE orders SET payout_batch_id = ? WHERE id = ?`).run(
      "BATCH-1",
      paid.id,
    );
    db.close();
    const payout = await POST(
      webhook({
        id: "WH-PAYOUT-1",
        event_type: "PAYMENT.PAYOUTSBATCH.SUCCESS",
        resource: { batch_header: { payout_batch_id: "BATCH-1" } },
      }),
    );
    assert.deepEqual(await payout.json(), {
      received: true,
      recorded: true,
      orderId: paid.id,
      escrowState: "PAID_OUT",
    });
  }),
);
