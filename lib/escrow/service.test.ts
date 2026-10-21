// Escrow service spec: the framework-free API behind /api/orders (and the AI
// procurement agent). Each test runs against an isolated temp-file DB; real
// mode uses an injected fake PayPal client — no network, no credentials.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import {
  createEscrowOrder,
  advanceEscrowOrder,
  EscrowError,
  type EscrowDeps,
} from "./service";
import { openDb, createOrder, getOrder, type OrderRow } from "../db/client";
import { createPayPalClient, type PayPalClient } from "../paypal/client";

const DATASET_ID = "ds_service_test";

function withDbEnv(
  fn: (ctx: { url: string }) => Promise<void>,
  opts: { mock?: boolean } = {},
): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-service-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const saved = {
      url: process.env.DATABASE_URL,
      mode: process.env.PAYPAL_MODE,
    };
    process.env.DATABASE_URL = url;
    if (opts.mock) process.env.PAYPAL_MODE = "mock";
    else delete process.env.PAYPAL_MODE;
    const db = openDb(url);
    db.prepare(
      `INSERT INTO vendors (id, name, payout_email) VALUES (?, ?, ?)`,
    ).run("vnd_svc", "Svc Vendor", "vendor-demo@meddata.test");
    db.prepare(
      `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
    ).run(DATASET_ID, "vnd_svc", "Service Cohort", 4900);
    db.close();
    try {
      await fn({ url });
    } finally {
      const restore = (k: string, v: string | undefined) =>
        v === undefined ? delete process.env[k] : (process.env[k] = v);
      restore("DATABASE_URL", saved.url);
      restore("PAYPAL_MODE", saved.mode);
      rmSync(path, { force: true });
    }
  };
}

function seedOrder(url: string, overrides: Partial<OrderRow> = {}): OrderRow {
  const db = openDb(url);
  const order = createOrder(db, {
    datasetId: DATASET_ID,
    buyerEmail: "b@example.com",
    amountCents: 4900,
    paypalOrderId: overrides.paypal_order_id ?? "PP-ORDER-1",
    authorizationId: overrides.authorization_id ?? null,
    status: overrides.status ?? "MATCHED",
  });
  db.close();
  return order;
}

/** A fake PayPal client recording every call; only the used methods matter. */
function fakePayPal() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    (method: string, result: unknown) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  const client = {
    createAuthorizeOrder: record("createAuthorizeOrder", {
      orderId: "PP-NEW",
      status: "CREATED",
      approveUrl: "https://paypal.test/approve",
    }),
    authorizeOrder: record("authorizeOrder", {
      orderId: "PP-ORDER-1",
      authorizationId: "AUTH-1",
      status: "CREATED",
    }),
    captureAuthorization: record("captureAuthorization", {
      captureId: "CAP-1",
      status: "COMPLETED",
    }),
    voidAuthorization: record("voidAuthorization", undefined),
  } as unknown as PayPalClient;
  const deps: EscrowDeps = { paypal: () => client };
  return { deps, calls };
}

async function rejectsWith(
  p: Promise<unknown>,
  status: number,
  code: string,
): Promise<void> {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof EscrowError, String(err));
    assert.equal(err.status, status);
    assert.equal(err.code, code);
    return true;
  });
}

test(
  "createEscrowOrder (real mode) persists the PayPal order at the listed price",
  withDbEnv(async ({ url }) => {
    const { deps, calls } = fakePayPal();
    const res = await createEscrowOrder({ datasetId: DATASET_ID }, deps);
    assert.equal(res.paypalOrderId, "PP-NEW");
    assert.equal(res.escrowState, "MATCHED");
    assert.equal(res.mock, undefined);
    assert.deepEqual((calls[0].args[0] as { amount: number }).amount, 49);
    assert.equal(getOrder(openDb(url), res.orderId)?.paypal_order_id, "PP-NEW");
  }),
);

test(
  "createEscrowOrder throws typed 422s for bad input",
  withDbEnv(
    async () => {
      await rejectsWith(
        createEscrowOrder({ datasetId: "" }),
        422,
        "VALIDATION",
      );
      await rejectsWith(
        createEscrowOrder({ datasetId: "ds_nope" }),
        422,
        "VALIDATION",
      );
      await rejectsWith(
        createEscrowOrder({ datasetId: DATASET_ID, amount: 0.01 }),
        422,
        "VALIDATION",
      );
    },
    { mock: true },
  ),
);

test(
  "advanceEscrowOrder: unknown order is NOT_FOUND, illegal move is INVALID_TRANSITION",
  withDbEnv(async ({ url }) => {
    const { deps, calls } = fakePayPal();
    await rejectsWith(
      advanceEscrowOrder({ orderId: "ord_nope", action: "deliver" }, deps),
      404,
      "NOT_FOUND",
    );
    const order = seedOrder(url);
    await rejectsWith(
      advanceEscrowOrder({ orderId: order.id, action: "capture" }, deps),
      409,
      "INVALID_TRANSITION",
    );
    assert.equal(calls.length, 0, "no PayPal call on an illegal move");
  }),
);

test(
  "advanceEscrowOrder (real mode) authorizes then captures via PayPal",
  withDbEnv(async ({ url }) => {
    const { deps, calls } = fakePayPal();
    const order = seedOrder(url);
    const auth = await advanceEscrowOrder(
      { orderId: order.id, action: "authorize" },
      deps,
    );
    assert.equal(auth.authorizationId, "AUTH-1");
    assert.equal(auth.order.authorization_id, "AUTH-1");
    await advanceEscrowOrder({ orderId: order.id, action: "deliver" }, deps);
    const cap = await advanceEscrowOrder(
      { orderId: order.id, action: "capture" },
      deps,
    );
    assert.equal(cap.escrowState, "CAPTURED");
    assert.equal(cap.captureId, "CAP-1");
    assert.deepEqual(
      calls.map((c) => c.method),
      ["authorizeOrder", "captureAuthorization"],
    );
  }),
);

test(
  "advanceEscrowOrder maps a missing PayPal config to NOT_CONFIGURED (503)",
  withDbEnv(async ({ url }) => {
    const order = seedOrder(url);
    const deps: EscrowDeps = {
      paypal: () => {
        throw new Error(
          "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set",
        );
      },
    };
    await rejectsWith(
      advanceEscrowOrder({ orderId: order.id, action: "authorize" }, deps),
      503,
      "NOT_CONFIGURED",
    );
    assert.equal(getOrder(openDb(url), order.id)?.status, "MATCHED");
  }),
);

/** A real PayPal client over an injected fetch that records every request. */
function payPalOverFetch(
  routes: Record<string, () => { status: number; body?: unknown }>,
) {
  const requests: Array<{
    url: string;
    headers: Record<string, string>;
    body?: string;
  }> = [];
  const fetchFn = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    requests.push({
      url: u,
      headers: (init.headers ?? {}) as Record<string, string>,
      body: init.body as string | undefined,
    });
    if (u.endsWith("/v1/oauth2/token"))
      return Response.json({ access_token: "tok", expires_in: 3600 });
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    if (!key) throw new Error(`no route for ${u}`);
    const { status, body } = routes[key]();
    return Response.json(body ?? {}, { status });
  }) as typeof fetch;
  const client = createPayPalClient({
    clientId: "cid",
    clientSecret: "secret",
    fetch: fetchFn,
  });
  const deps: EscrowDeps = { paypal: () => client };
  return { deps, requests };
}

const PAYOUT_OK = () => ({
  status: 201,
  body: {
    batch_header: { payout_batch_id: "BATCH-77", batch_status: "PENDING" },
  },
});

test(
  "payout (real mode) pays the vendor's email the amount minus the platform fee",
  withDbEnv(async ({ url }) => {
    const { deps, requests } = payPalOverFetch({
      "/v1/payments/payouts": PAYOUT_OK,
    });
    const order = seedOrder(url, { status: "CAPTURED" });
    const res = await advanceEscrowOrder(
      { orderId: order.id, action: "payout" },
      deps,
    );
    assert.equal(res.escrowState, "PAID_OUT");
    assert.equal(res.payoutBatchId, "BATCH-77");
    assert.equal(res.status, "PENDING");
    assert.equal(res.order.payout_batch_id, "BATCH-77");

    const call = requests.find((r) => r.url.endsWith("/v1/payments/payouts"))!;
    assert.equal(call.headers["PayPal-Request-Id"], `${order.id}:payout`);
    const sent = JSON.parse(call.body!);
    assert.equal(
      sent.sender_batch_header.sender_batch_id,
      `payout_${order.id}`,
    );
    assert.equal(sent.items[0].receiver, "vendor-demo@meddata.test");
    // 4900 cents captured, 10% platform fee -> 4410 to the vendor.
    assert.deepEqual(sent.items[0].amount, { value: "44.10", currency: "USD" });
  }),
);

test(
  "payout (real mode) without a vendor payout email is a 409 and writes nothing",
  withDbEnv(async ({ url }) => {
    const db = openDb(url);
    db.prepare(`UPDATE vendors SET payout_email = NULL`).run();
    db.close();
    const { deps, requests } = payPalOverFetch({
      "/v1/payments/payouts": PAYOUT_OK,
    });
    const order = seedOrder(url, { status: "CAPTURED" });
    await rejectsWith(
      advanceEscrowOrder({ orderId: order.id, action: "payout" }, deps),
      409,
      "PRECONDITION",
    );
    assert.equal(requests.length, 0);
    assert.equal(getOrder(openDb(url), order.id)?.status, "CAPTURED");
  }),
);

test(
  "payout (real mode) surfaces a PayPal failure as a PAYPAL error and stays CAPTURED",
  withDbEnv(async ({ url }) => {
    const { deps } = payPalOverFetch({
      "/v1/payments/payouts": () => ({ status: 422, body: { name: "ERR" } }),
    });
    const order = seedOrder(url, { status: "CAPTURED" });
    await rejectsWith(
      advanceEscrowOrder({ orderId: order.id, action: "payout" }, deps),
      422,
      "PAYPAL",
    );
    assert.equal(getOrder(openDb(url), order.id)?.status, "CAPTURED");
  }),
);

test(
  "payout (mock mode) returns and persists a mock batch id",
  withDbEnv(
    async ({ url }) => {
      const order = seedOrder(url, { status: "CAPTURED" });
      const res = await advanceEscrowOrder({
        orderId: order.id,
        action: "payout",
      });
      assert.match(String(res.payoutBatchId), /^MOCK-PAYOUT-/);
      assert.equal(res.mock, true);
      assert.equal(
        getOrder(openDb(url), order.id)?.payout_batch_id,
        res.payoutBatchId,
      );
    },
    { mock: true },
  ),
);

test(
  "advanceEscrowOrder derives PayPal-Request-Ids from the order id + operation",
  withDbEnv(async ({ url }) => {
    const { deps, calls } = fakePayPal();
    const created = await createEscrowOrder({ datasetId: DATASET_ID }, deps);
    const id = created.orderId;
    await advanceEscrowOrder({ orderId: id, action: "authorize" }, deps);
    await advanceEscrowOrder({ orderId: id, action: "dispute" }, deps);
    await advanceEscrowOrder(
      { orderId: id, action: "resolve", resolution: "capture" },
      deps,
    );
    const voidable = seedOrder(url, {
      status: "AUTHORIZED",
      authorization_id: "AUTH-V",
    });
    await advanceEscrowOrder(
      { orderId: voidable.id, action: "void", requestId: "caller-key" },
      deps,
    );

    const keyOf = (i: number) => {
      const args = calls[i].args;
      return (args[args.length - 1] as { requestId?: string }).requestId;
    };
    assert.equal(keyOf(0), `${id}:create`);
    assert.equal(keyOf(1), `${id}:authorize`);
    // A dispute-resolve capture shares the plain capture key (no double charge).
    assert.equal(keyOf(2), `${id}:capture`);
    assert.equal(keyOf(3), "caller-key");
  }),
);
