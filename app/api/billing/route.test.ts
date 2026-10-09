// /api/billing spec — records per-query usage. Uses an isolated temp SQLite
// file (never ./data/dev.sqlite) injected via DATABASE_URL, with a seeded
// order so the FK is satisfied. Calls the exported POST with a Web Request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { POST } from "./route";
import { openDb, createOrder } from "../../../lib/db/client";

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
// one order, and close. The route reopens the same file via DATABASE_URL.
function seed(path: string): void {
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

test("records usage for a known order (201), defaulting the fee", async () => {
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
    assert.equal(json.chargeCents, 50); // default per-query fee
    assert.match(json.usageId, /^qu_/);
  });
});

test("honors an explicit chargeCents", async () => {
  const path = tmpDbPath();
  await withDbEnv(path, async () => {
    seed(path);
    const res = await POST(
      req({
        orderId: "ord_test",
        question: "count by region",
        chargeCents: 125,
      }),
    );
    assert.equal(res.status, 201);
    const json = await res.json();
    assert.equal(json.chargeCents, 125);
  });
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
