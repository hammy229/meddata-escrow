// Route input/transition/persistence spec. The route now persists through the
// SQLite DB layer, so each test runs against an isolated temp-file DB (not
// :memory:, because withDb opens a fresh connection per call — an in-memory DB
// would be empty on the next call). DATABASE_URL points the route at that file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { GET, POST, PATCH } from "./route";
import {
  openDb,
  createOrder,
  getOrder,
  advanceOrder,
  type OrderRow,
} from "../../../lib/db/client";

const DATASET_ID = "ds_cardio_synthea_v1";

function req(body: unknown, method = "POST") {
  return new Request("http://localhost/api/orders", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Insert the vendor + dataset an order's FK needs. */
function seed(url: string) {
  const db = openDb(url);
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "vnd_demo_health",
    "Demo Health",
  );
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run(DATASET_ID, "vnd_demo_health", "Cardio Cohort", 4900);
  db.close();
}

/** Insert a MATCHED order row directly (for tests that don't POST first). */
function seedOrder(
  url: string,
  overrides: Record<string, unknown> = {},
): OrderRow {
  const db = openDb(url);
  const order = createOrder(db, {
    datasetId: DATASET_ID,
    buyerEmail: "b@example.com",
    amountCents: 4900,
    paypalOrderId: "PP-ORDER-1",
    status: "MATCHED",
    ...overrides,
  });
  db.close();
  return order;
}

/**
 * Wrap a test body with an isolated temp DB (seeded) and restored env. Set
 * `mock` to run it in PAYPAL_MODE=mock; set `noCreds` to strip PayPal creds.
 */
function withEnv(
  fn: (ctx: { url: string }) => Promise<void>,
  opts: { mock?: boolean; noCreds?: boolean } = {},
): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-orders-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const saved = {
      url: process.env.DATABASE_URL,
      mode: process.env.PAYPAL_MODE,
      id: process.env.PAYPAL_CLIENT_ID,
      secret: process.env.PAYPAL_CLIENT_SECRET,
    };
    process.env.DATABASE_URL = url;
    if (opts.mock) process.env.PAYPAL_MODE = "mock";
    if (opts.noCreds) {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;
    }
    seed(url);
    try {
      await fn({ url });
    } finally {
      const restore = (k: string, v: string | undefined) =>
        v === undefined ? delete process.env[k] : (process.env[k] = v);
      restore("DATABASE_URL", saved.url);
      restore("PAYPAL_MODE", saved.mode);
      restore("PAYPAL_CLIENT_ID", saved.id);
      restore("PAYPAL_CLIENT_SECRET", saved.secret);
      rmSync(path, { force: true });
    }
  };
}

// --- Input validation (resolves before any PayPal/DB write that could fail) ---

test(
  "POST rejects a non-numeric or non-positive amount with 422",
  withEnv(async () => {
    for (const amount of ["49", 0, -49]) {
      const res = await POST(req({ datasetId: DATASET_ID, amount }));
      assert.equal(res.status, 422, `amount=${JSON.stringify(amount)}`);
    }
  }),
);

test(
  "POST rejects a missing datasetId with 422",
  withEnv(async () => {
    const res = await POST(req({ amount: 49 }));
    assert.equal(res.status, 422);
  }),
);

test(
  "POST rejects an unknown datasetId with 422",
  withEnv(async () => {
    const res = await POST(req({ datasetId: "ds_nope", amount: 42 }));
    assert.equal(res.status, 422);
  }),
);

test(
  "PATCH rejects an unknown action with 422",
  withEnv(async () => {
    const res = await PATCH(
      req({ action: "refund", orderId: "ord_x" }, "PATCH"),
    );
    assert.equal(res.status, 422);
  }),
);

test(
  "PATCH without orderId is 422",
  withEnv(async () => {
    const res = await PATCH(req({ action: "authorize" }, "PATCH"));
    assert.equal(res.status, 422);
  }),
);

test(
  "PATCH on an unknown orderId is 404",
  withEnv(async () => {
    const res = await PATCH(
      req({ action: "authorize", orderId: "ord_missing" }, "PATCH"),
    );
    assert.equal(res.status, 404);
  }),
);

test(
  "PATCH resolve without a resolution is 422",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { status: "DISPUTED" });
    const res = await PATCH(
      req({ action: "resolve", orderId: order.id }, "PATCH"),
    );
    assert.equal(res.status, 422);
  }),
);

test(
  "PATCH capture from an illegal state is 409 (no charge attempted)",
  withEnv(async ({ url }) => {
    const order = seedOrder(url); // MATCHED
    const res = await PATCH(
      req({ action: "capture", orderId: order.id }, "PATCH"),
    );
    assert.equal(res.status, 409);
    assert.equal(getOrder(openDb(url), order.id)?.status, "MATCHED"); // unchanged
  }),
);

test(
  "PATCH authorize with valid input reaches PayPal and reports it unconfigured (503) without creds",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url); // MATCHED, has a paypal_order_id
      const res = await PATCH(
        req({ action: "authorize", orderId: order.id }, "PATCH"),
      );
      assert.equal(res.status, 503);
    },
    { noCreds: true },
  ),
);

// --- MOCK MODE (opt-in via PAYPAL_MODE=mock): creds-free, DB-persisted escrow ---

test(
  "POST in mock mode returns 201 with a DB orderId, a mock paypalOrderId, and MATCHED",
  withEnv(
    async ({ url }) => {
      const res = await POST(req({ datasetId: DATASET_ID, amount: 49 }));
      assert.equal(res.status, 201);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.mock, true);
      assert.equal(json.status, "CREATED");
      assert.equal(json.escrowState, "MATCHED");
      assert.match(String(json.orderId), /^ord_/);
      assert.match(String(json.paypalOrderId), /^MOCK-ORDER-/);
      assert.match(String(json.approveUrl), /checkoutnow\?token=MOCK-ORDER-/);
      // Persisted: the row exists with the right amount and state.
      const row = getOrder(openDb(url), String(json.orderId));
      assert.equal(row?.status, "MATCHED");
      assert.equal(row?.amount_cents, 4900);
    },
    { mock: true },
  ),
);

// --- Pricing: the escrowed amount is the dataset's listed price, never the client's ---

test(
  "POST with a tampered amount is 422 and writes no order",
  withEnv(
    async ({ url }) => {
      const res = await POST(req({ datasetId: DATASET_ID, amount: 0.01 }));
      assert.equal(res.status, 422);
      const json = (await res.json()) as { error: string };
      assert.equal(json.error, "amount does not match the listed price");
      const db = openDb(url);
      const { n } = db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as {
        n: number;
      };
      db.close();
      assert.equal(n, 0);
    },
    { mock: true },
  ),
);

test(
  "POST without an amount escrows the dataset's listed price",
  withEnv(
    async ({ url }) => {
      const res = await POST(req({ datasetId: DATASET_ID }));
      assert.equal(res.status, 201);
      const json = (await res.json()) as { orderId: string };
      assert.equal(getOrder(openDb(url), json.orderId)?.amount_cents, 4900);
    },
    { mock: true },
  ),
);

test(
  "POST with an amount matching the listed price (float-safe) is 201",
  withEnv(
    async ({ url }) => {
      // 49 dollars as the researcher UI sends it: priceCents / 100.
      const res = await POST(
        req({ datasetId: DATASET_ID, amount: 4900 / 100 }),
      );
      assert.equal(res.status, 201);
      const json = (await res.json()) as { orderId: string };
      assert.equal(getOrder(openDb(url), json.orderId)?.amount_cents, 4900);
    },
    { mock: true },
  ),
);

test(
  "POST for a dataset with no listed price is 422",
  withEnv(
    async ({ url }) => {
      const db = openDb(url);
      db.prepare(
        `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
      ).run("ds_free", "vnd_demo_health", "Unpriced", 0);
      db.close();
      const res = await POST(req({ datasetId: "ds_free" }));
      assert.equal(res.status, 422);
    },
    { mock: true },
  ),
);

test(
  "PATCH authorize in mock mode: MATCHED -> AUTHORIZED, persisted with a mock authorizationId",
  withEnv(
    async ({ url }) => {
      const created = (await (
        await POST(req({ datasetId: DATASET_ID, amount: 49 }))
      ).json()) as { orderId: string };

      const res = await PATCH(
        req({ action: "authorize", orderId: created.orderId }, "PATCH"),
      );
      assert.equal(res.status, 200);
      const json = (await res.json()) as Record<string, unknown>;
      assert.equal(json.escrowState, "AUTHORIZED");
      assert.match(String(json.authorizationId), /^MOCK-AUTH-/);

      const row = getOrder(openDb(url), created.orderId);
      assert.equal(row?.status, "AUTHORIZED");
      assert.equal(row?.authorization_id, json.authorizationId);
    },
    { mock: true },
  ),
);

test(
  "PATCH in mock mode drives the full legal arc to PAID_OUT (persisted at each step)",
  withEnv(
    async ({ url }) => {
      const created = (await (
        await POST(req({ datasetId: DATASET_ID, amount: 49 }))
      ).json()) as { orderId: string };
      const id = created.orderId;
      const step = async (action: string, expected: string) => {
        const res = await PATCH(req({ action, orderId: id }, "PATCH"));
        assert.equal(res.status, 200, `${action} status`);
        assert.equal(
          ((await res.json()) as { escrowState: string }).escrowState,
          expected,
        );
        assert.equal(getOrder(openDb(url), id)?.status, expected);
      };
      await step("authorize", "AUTHORIZED");
      await step("deliver", "DELIVERED");
      await step("capture", "CAPTURED");
      await step("payout", "PAID_OUT");
    },
    { mock: true },
  ),
);

test(
  "PATCH in mock mode: void from AUTHORIZED reaches VOIDED",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url, {
        status: "AUTHORIZED",
        authorizationId: "MOCK-AUTH-seed",
      });
      const res = await PATCH(
        req({ action: "void", orderId: order.id }, "PATCH"),
      );
      assert.equal(res.status, 200);
      assert.equal(
        ((await res.json()) as { escrowState: string }).escrowState,
        "VOIDED",
      );
      assert.equal(getOrder(openDb(url), order.id)?.status, "VOIDED");
    },
    { mock: true },
  ),
);

test(
  "PATCH in mock mode: an illegal transition is still 409 (no PayPal reached)",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url); // MATCHED
      const res = await PATCH(
        req({ action: "capture", orderId: order.id }, "PATCH"),
      );
      assert.equal(res.status, 409);
    },
    { mock: true },
  ),
);

// --- Dispute -> resolve flow ---

test(
  "dispute then resolve=capture: AUTHORIZED -> DISPUTED -> CAPTURED",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url, {
        status: "AUTHORIZED",
        authorizationId: "MOCK-AUTH-seed",
      });

      const disputed = await PATCH(
        req({ action: "dispute", orderId: order.id }, "PATCH"),
      );
      assert.equal(disputed.status, 200);
      assert.equal(
        ((await disputed.json()) as { escrowState: string }).escrowState,
        "DISPUTED",
      );

      const resolved = await PATCH(
        req(
          { action: "resolve", resolution: "capture", orderId: order.id },
          "PATCH",
        ),
      );
      assert.equal(resolved.status, 200);
      const json = (await resolved.json()) as Record<string, unknown>;
      assert.equal(json.escrowState, "CAPTURED");
      assert.match(String(json.captureId), /^MOCK-CAP-/);
      assert.equal(getOrder(openDb(url), order.id)?.status, "CAPTURED");
    },
    { mock: true },
  ),
);

test(
  "dispute then resolve=void: DELIVERED -> DISPUTED -> VOIDED",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url, {
        status: "DELIVERED",
        authorizationId: "MOCK-AUTH-seed",
      });

      await PATCH(req({ action: "dispute", orderId: order.id }, "PATCH"));
      const resolved = await PATCH(
        req(
          { action: "resolve", resolution: "void", orderId: order.id },
          "PATCH",
        ),
      );
      assert.equal(resolved.status, 200);
      assert.equal(
        ((await resolved.json()) as { escrowState: string }).escrowState,
        "VOIDED",
      );
      assert.equal(getOrder(openDb(url), order.id)?.status, "VOIDED");
    },
    { mock: true },
  ),
);

test(
  "resolve from a non-disputed state is 409",
  withEnv(
    async ({ url }) => {
      const order = seedOrder(url, { status: "AUTHORIZED" });
      const res = await PATCH(
        req(
          { action: "resolve", resolution: "capture", orderId: order.id },
          "PATCH",
        ),
      );
      assert.equal(res.status, 409);
    },
    { mock: true },
  ),
);

// --- GET (read endpoint for the UI) ---

function getReq(query = "") {
  return new Request(`http://localhost/api/orders${query}`, { method: "GET" });
}

test(
  "GET lists all orders, newest first",
  withEnv(async ({ url }) => {
    const a = seedOrder(url, { id: "ord_a" });
    const b = seedOrder(url, { id: "ord_b" });
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const json = (await res.json()) as { orders: Array<{ id: string }> };
    assert.deepEqual(
      json.orders.map((o) => o.id),
      [b.id, a.id], // same timestamp -> id DESC tiebreak
    );
  }),
);

test(
  "GET ?id= returns a single order, or 404 when unknown",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { id: "ord_one" });
    const ok = await GET(getReq(`?id=${order.id}`));
    assert.equal(ok.status, 200);
    assert.equal(
      ((await ok.json()) as { order: { id: string } }).order.id,
      order.id,
    );

    const missing = await GET(getReq("?id=ord_nope"));
    assert.equal(missing.status, 404);
  }),
);

test(
  "GET ?status= filters by escrow state",
  withEnv(async ({ url }) => {
    seedOrder(url, { id: "ord_matched" });
    seedOrder(url, { id: "ord_disputed", status: "DISPUTED" });
    const res = await GET(getReq("?status=DISPUTED"));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { orders: Array<{ id: string }> };
    assert.deepEqual(
      json.orders.map((o) => o.id),
      ["ord_disputed"],
    );
  }),
);

test(
  "GET ?status= with an unknown state is 422",
  withEnv(async () => {
    const res = await GET(getReq("?status=REFUNDED"));
    assert.equal(res.status, 422);
  }),
);

test(
  "GET ?id=..&events= returns the order's audit timeline",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { id: "ord_tl" });
    const db = openDb(url);
    advanceOrder(db, order.id, "AUTHORIZE");
    advanceOrder(db, order.id, "DELIVER");
    db.close();

    const res = await GET(getReq(`?id=${order.id}&events=1`));
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      order: { status: string };
      events: Array<{ event: string }>;
    };
    assert.equal(json.order.status, "DELIVERED");
    assert.deepEqual(
      json.events.map((e) => e.event),
      ["CREATE", "AUTHORIZE", "DELIVER"],
    );
  }),
);

test(
  "GET ?id= omits events unless they are requested",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { id: "ord_plain" });
    const res = await GET(getReq(`?id=${order.id}`));
    assert.equal(res.status, 200);
    const json = (await res.json()) as { events?: unknown };
    assert.equal(json.events, undefined);
  }),
);

test(
  "GET ?summary=1 returns zero-filled counts and the earnings buckets",
  withEnv(async ({ url }) => {
    seedOrder(url, { id: "ord_m" }); // MATCHED, 4900
    seedOrder(url, { id: "ord_a", status: "AUTHORIZED", amountCents: 1000 });
    seedOrder(url, { id: "ord_c", status: "CAPTURED", amountCents: 2000 });
    seedOrder(url, { id: "ord_p", status: "PAID_OUT", amountCents: 3000 });
    seedOrder(url, { id: "ord_v", status: "VOIDED", amountCents: 500 });

    const res = await GET(getReq("?summary=1"));
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      summary: Record<string, unknown> & {
        countsByStatus: Record<string, number>;
      };
      orders?: unknown;
    };
    assert.equal(json.orders, undefined);
    assert.deepEqual(json.summary.countsByStatus, {
      MATCHED: 1,
      AUTHORIZED: 1,
      DELIVERED: 0,
      CAPTURED: 1,
      PAID_OUT: 1,
      DISPUTED: 0,
      VOIDED: 1,
      CANCELLED: 0,
    });
    assert.equal(json.summary.heldCents, 1000);
    assert.equal(json.summary.capturedCents, 5000);
    assert.equal(json.summary.paidOutCents, 3000);
    assert.equal(json.summary.releasedCents, 500);
  }),
);

test(
  "GET ?summary=1&datasetId= scopes the summary to one dataset",
  withEnv(async ({ url }) => {
    seedOrder(url, { id: "ord_c", status: "CAPTURED", amountCents: 2000 });
    const res = await GET(getReq("?summary=1&datasetId=ds_other"));
    assert.equal(res.status, 200);
    const json = (await res.json()) as {
      summary: { capturedCents: number; countsByStatus: { CAPTURED: number } };
    };
    assert.equal(json.summary.capturedCents, 0);
    assert.equal(json.summary.countsByStatus.CAPTURED, 0);
  }),
);

test(
  "PATCH dispute records the reason on the audit event",
  withEnv(async ({ url }) => {
    const order = seedOrder(url, { id: "ord_disp", status: "AUTHORIZED" });
    const res = await PATCH(
      req(
        {
          action: "dispute",
          orderId: order.id,
          note: "dataset was incomplete",
        },
        "PATCH",
      ),
    );
    assert.equal(res.status, 200);

    const events = await GET(getReq(`?id=${order.id}&events=1`));
    const json = (await events.json()) as {
      events: Array<{ event: string; note: string | null }>;
    };
    assert.equal(
      json.events.find((e) => e.event === "DISPUTE")?.note,
      "dataset was incomplete",
    );
  }),
);
