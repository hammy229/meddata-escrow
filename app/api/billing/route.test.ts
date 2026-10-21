// /api/billing spec — records per-query usage. Uses an isolated temp SQLite
// file (never ./data/dev.sqlite) injected via DATABASE_URL, with a seeded
// order so the FK is satisfied. Calls the exported GET/POST with a Web Request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { GET, POST } from "./route";
import { openDb, createOrder } from "../../../lib/db/client";
import {
  listUsage,
  recordUsage,
  PER_QUERY_FEE_CENTS,
} from "../../../lib/db/usage";
import type { EscrowState } from "../../../lib/escrow/state-machine";

function tmpDbPath() {
  return join(tmpdir(), `meddata-billing-${randomUUID()}.sqlite`);
}

function req(body: unknown) {
  return new Request("http://localhost/api/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// Open the temp DB, insert the vendor/dataset parents orders require, create
// one order (DELIVERED by default — billable), and close. The route reopens the
// same file via DATABASE_URL.
function seed(path: string, status: EscrowState = "DELIVERED"): void {
  const db = openDb(path);
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "vnd_demo_health",
    "Demo Health",
  );
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_x", "vnd_demo_health", "Test Dataset", 100);
  createOrder(db, {
    id: "ord_test",
    datasetId: "ds_x",
    buyerEmail: "b@example.com",
    amountCents: 100,
    status,
  });
  db.close();
}

async function withDbEnv(path: string, fn: () => Promise<void>) {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = path;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    rmSync(path, { force: true });
  }
}

test("records usage for a known order (201) at the server fee", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    seed(path);
    const res = await POST(
      req({ orderId: "ord_test", question: "count(*) of patients by sex" }),
    );
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.orderId, "ord_test");
    assert.equal(json.charged, true);
    assert.equal(json.chargeCents, PER_QUERY_FEE_CENTS);
    assert.equal(PER_QUERY_FEE_CENTS, 50);
    assert.match(json.usageId, /^qu_/);
  });
});

test("a chargeCents equal to the server fee is accepted", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    seed(path);
    const res = await POST(
      req({
        orderId: "ord_test",
        question: "count by region",
        chargeCents: PER_QUERY_FEE_CENTS,
      }),
    );
    assert.equal(res.status, 201);
    assert.equal((await res.json()).chargeCents, PER_QUERY_FEE_CENTS);
  });
});

test("a client-chosen chargeCents (e.g. 0 = free) is 422 and records nothing", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    seed(path);
    for (const chargeCents of [0, 125, "50"]) {
      const res = await POST(
        req({ orderId: "ord_test", question: "count by region", chargeCents }),
      );
      assert.equal(
        res.status,
        422,
        `chargeCents=${JSON.stringify(chargeCents)}`,
      );
    }
    const db = openDb(path);
    assert.equal(listUsage(db, "ord_test").length, 0);
    db.close();
  });
});

test("orders without data access are 409 and record nothing", async () => {
  for (const status of [
    "MATCHED",
    "AUTHORIZED",
    "DISPUTED",
    "VOIDED",
    "CANCELLED",
  ] as EscrowState[]) {
    const path = tmpDbPath();
    await withDbEnv(path, async () => {
      seed(path, status);
      const res = await POST(
        req({ orderId: "ord_test", question: "count by sex" }),
      );
      assert.equal(res.status, 409, status);
      const db = openDb(path);
      assert.equal(listUsage(db, "ord_test").length, 0);
      db.close();
    });
  }
});

test("CAPTURED and PAID_OUT orders are billable", async () => {
  for (const status of ["CAPTURED", "PAID_OUT"] as EscrowState[]) {
    const path = tmpDbPath();
    await withDbEnv(path, async () => {
      seed(path, status);
      const res = await POST(
        req({ orderId: "ord_test", question: "count by sex" }),
      );
      assert.equal(res.status, 201, status);
    });
  }
});

test("unknown orderId -> 422 (not 500)", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    openDb(path).close(); // migrate an empty DB (no orders)
    const res = await POST(
      req({ orderId: "ord_missing", question: "count by sex" }),
    );
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.match(json.error, /unknown orderId/);
  });
});

test("missing fields -> 422", async () => {
  const res = await POST(req({ orderId: "ord_test" }));
  assert.equal(res.status, 422);
});

// --- GET /api/billing?orderId= (usage + spend for one order) ---

function getReq(query = "") {
  return new Request(`http://localhost/api/billing${query}`, {
    method: "GET",
  });
}

test("GET returns an order's usage newest first, with count and total", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    seed(path);
    const db = openDb(path);
    recordUsage(db, {
      id: "qu_old",
      orderId: "ord_test",
      question: "first",
      chargeCents: 50,
    });
    recordUsage(db, {
      id: "qu_new",
      orderId: "ord_test",
      question: "second",
      chargeCents: 75,
    });
    // created_at is second-resolution; pin distinct times so order is certain.
    const setAt = db.prepare(
      `UPDATE query_usage SET created_at = ? WHERE id = ?`,
    );
    setAt.run("2026-01-01 00:00:00", "qu_old");
    setAt.run("2026-01-02 00:00:00", "qu_new");
    db.close();

    const res = await GET(getReq("?orderId=ord_test"));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.orderId, "ord_test");
    assert.deepEqual(
      json.usage.map((u: { id: string }) => u.id),
      ["qu_new", "qu_old"],
    );
    assert.equal(json.usage[0].charge_cents, 75);
    assert.equal(json.queryCount, 2);
    assert.equal(json.totalCents, 125);
  });
});

test("GET for an order with no usage returns zeros", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    seed(path);
    const res = await GET(getReq("?orderId=ord_test"));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      orderId: "ord_test",
      usage: [],
      queryCount: 0,
      totalCents: 0,
    });
  });
});

test("GET without orderId -> 422", async () => {
  assert.equal((await GET(getReq())).status, 422);
  assert.equal((await GET(getReq("?orderId="))).status, 422);
});

test("GET for an unknown orderId -> 404", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    openDb(path).close(); // migrate an empty DB (no orders)
    const res = await GET(getReq("?orderId=ord_missing"));
    assert.equal(res.status, 404);
    assert.match((await res.json()).error, /unknown orderId/);
  });
});
