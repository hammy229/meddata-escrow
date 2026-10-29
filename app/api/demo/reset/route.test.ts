// Demo reset route: mock-mode only, wipes orders and reseeds the catalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { POST } from "./route";
import { openDb, createOrder } from "../../../../lib/db/client";
import { seedDatabase } from "../../../../lib/db/seed";

function withEnv(
  fn: (ctx: { url: string }) => Promise<void>,
  mode: string | undefined,
): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-reset-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const saved = {
      url: process.env.DATABASE_URL,
      mode: process.env.PAYPAL_MODE,
    };
    process.env.DATABASE_URL = url;
    if (mode === undefined) delete process.env.PAYPAL_MODE;
    else process.env.PAYPAL_MODE = mode;
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

/** Seed the catalog and one order; returns how many orders exist. */
function seedWithOrder(url: string) {
  const db = openDb(url);
  seedDatabase(db);
  const ds = db.prepare(`SELECT id FROM datasets LIMIT 1`).get() as {
    id: string;
  };
  createOrder(db, {
    datasetId: ds.id,
    buyerEmail: "b@example.com",
    amountCents: 4900,
  });
  db.close();
}

const orderCount = (url: string) => {
  const db = openDb(url);
  const n = (
    db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as {
      n: number;
    }
  ).n;
  db.close();
  return n;
};

test(
  "POST in mock mode clears orders and returns { ok: true }",
  withEnv(async ({ url }) => {
    seedWithOrder(url);
    assert.equal(orderCount(url), 1);
    const res = await POST();
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(orderCount(url), 0);
  }, "mock"),
);

test(
  "POST outside mock mode is 404 { error } and leaves data alone",
  withEnv(async ({ url }) => {
    seedWithOrder(url);
    const res = await POST();
    assert.equal(res.status, 404);
    const json = (await res.json()) as { error: string };
    assert.equal(typeof json.error, "string");
    assert.equal(orderCount(url), 1);
  }, undefined),
);

test(
  "POST with PAYPAL_MODE=live is also 404",
  withEnv(async ({ url }) => {
    seedWithOrder(url);
    assert.equal((await POST()).status, 404);
    assert.equal(orderCount(url), 1);
  }, "live"),
);
