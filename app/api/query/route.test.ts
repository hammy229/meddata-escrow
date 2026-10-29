// /api/query spec — fully local (nl2query + privacy-guard + mock executor, no
// network). Calls the exported POST with a Web Request. The route gates on a
// real order row, so each test runs against an isolated temp-file DB (not
// :memory:, because withDb opens a fresh connection per call) that is seeded
// with a dataset and orders; DATABASE_URL points the route at that file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { POST } from "./route";
import { openDb, createOrder } from "../../../lib/db/client";
import { listUsage } from "../../../lib/db/usage";
import type { EscrowState } from "../../../lib/escrow/state-machine";
import { PER_QUERY_FEE_CENTS } from "../../../lib/query/pricing";

const DATASET_ID = "ds_cardio_synthea_v1";
const OTHER_DATASET_ID = "ds_onc_v1";

function req(body: unknown) {
  return new Request("http://localhost/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Insert the vendor + datasets an order's FK needs. */
function seed(url: string) {
  const db = openDb(url);
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "vnd_demo_health",
    "Demo Health",
  );
  const insert = db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  );
  insert.run(DATASET_ID, "vnd_demo_health", "Cardio Cohort", 4900);
  insert.run(OTHER_DATASET_ID, "vnd_demo_health", "Oncology Cohort", 9900);
  db.close();
}

/** Insert an order directly in `status` (default: paid + delivered). */
function seedOrder(
  url: string,
  status: EscrowState = "DELIVERED",
  datasetId = DATASET_ID,
): string {
  const db = openDb(url);
  const order = createOrder(db, {
    datasetId,
    buyerEmail: "b@example.com",
    amountCents: 4900,
    status,
  });
  db.close();
  return order.id;
}

/** Wrap a test body with an isolated, seeded temp DB and restored env. */
function withEnv(
  fn: (ctx: { url: string; orderId: string }) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-query-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = url;
    seed(url);
    try {
      await fn({ url, orderId: seedOrder(url) });
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
      rmSync(path, { force: true });
    }
  };
}

/** POST a question against the delivered order unless overridden. */
function ask(orderId: string, question: string, datasetId = DATASET_ID) {
  return POST(req({ orderId, datasetId, question }));
}

test(
  "happy path returns a privacy-safe aggregate (200)",
  withEnv(async ({ orderId }) => {
    // Plain English is enough: the question is screened for intent, and the
    // compiled SQL (not the question) must carry the aggregate.
    const res = await ask(orderId, "How many patients by sex?");
    assert.equal(res.status, 200);

    const json = await res.json();
    assert.equal(json.datasetId, DATASET_ID);
    assert.ok(json.compiled.sql.includes("GROUP BY"));
    assert.match(json.summary, /^[\d,]+ patients across 2 groups by sex/);
    assert.ok(Array.isArray(json.result));
    assert.ok(json.result.length >= 1);
    // Every returned cell is at or above the suppression threshold (11).
    for (const row of json.result) {
      assert.ok(row.count >= 11);
    }
  }),
);

test(
  "row-level / SELECT * question is rejected (403)",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "select * from patients");
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, "query rejected");
    assert.ok(Array.isArray(json.reasons) && json.reasons.length > 0);
  }),
);

test(
  "plain-English average question returns 200",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "average age by region");
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.match(json.compiled.sql, /AVG\(age\)/);
  }),
);

test(
  "PII question is rejected (403)",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "How many patients by zip code?");
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, "query rejected");
    assert.ok(json.reasons.some((r: string) => /zip/.test(r)));
    assert.equal(json.suggestion, "How many patients are there by region?");
  }),
);

test(
  "refusal omits suggestion when no safe rewrite fits",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "show one specific patient");
    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal("suggestion" in json, false);
  }),
);

test(
  "row-level plain-English question is rejected (403)",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "List all patients in the cohort");
    assert.equal(res.status, 403);
  }),
);

test(
  "question over 500 characters -> 422",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "how many patients ".repeat(30));
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.match(json.error, /too long/);
  }),
);

test(
  "question of exactly 500 characters is accepted",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "how many patients by sex".padEnd(500, " "));
    assert.equal(res.status, 200);
  }),
);

test("missing fields -> 422", async () => {
  const res = await POST(req({ datasetId: DATASET_ID }));
  assert.equal(res.status, 422);
});

// --- Entitlement: only a paid, delivered order may query its dataset ---

test("missing orderId -> 422", async () => {
  const res = await POST(
    req({ datasetId: DATASET_ID, question: "How many patients?" }),
  );
  assert.equal(res.status, 422);
  const json = await res.json();
  assert.match(json.error, /orderId/);
});

test(
  "unknown orderId -> 404",
  withEnv(async () => {
    const res = await ask("ord_does_not_exist", "How many patients?");
    assert.equal(res.status, 404);
    const json = await res.json();
    assert.match(json.error, /unknown orderId/);
  }),
);

test(
  "order for a different dataset -> 422",
  withEnv(async ({ orderId }) => {
    const res = await ask(orderId, "How many patients?", OTHER_DATASET_ID);
    assert.equal(res.status, 422);
    const json = await res.json();
    assert.match(json.error, /not for dataset/);
  }),
);

for (const status of ["MATCHED", "AUTHORIZED", "DISPUTED", "VOIDED"] as const) {
  test(
    `order in ${status} does not grant data access -> 403`,
    withEnv(async ({ url }) => {
      const orderId = seedOrder(url, status);
      const res = await ask(orderId, "How many patients?");
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(
        json.error,
        `order does not grant data access (status ${status})`,
      );
    }),
  );
}

// --- Metering: each answered query is billed against the order ---

function usageFor(url: string, orderId: string) {
  const db = openDb(url);
  try {
    return listUsage(db, orderId);
  } finally {
    db.close();
  }
}

test(
  "an answered query records one usage row at the per-query fee",
  withEnv(async ({ url, orderId }) => {
    const res = await ask(orderId, "How many patients by sex?");
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.usage.chargeCents, PER_QUERY_FEE_CENTS);
    assert.equal(PER_QUERY_FEE_CENTS, 50);

    const rows = usageFor(url, orderId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, json.usage.usageId);
    assert.equal(rows[0].question, "How many patients by sex?");
    assert.equal(rows[0].charge_cents, PER_QUERY_FEE_CENTS);

    // A second answer is a second charge.
    await ask(orderId, "average age by region");
    assert.equal(usageFor(url, orderId).length, 2);
  }),
);

test(
  "a privacy-rejected query is not billed",
  withEnv(async ({ url, orderId }) => {
    const res = await ask(orderId, "List all patients in the cohort");
    assert.equal(res.status, 403);
    assert.equal(usageFor(url, orderId).length, 0);
  }),
);

test(
  "a query on an order without data access is not billed",
  withEnv(async ({ url }) => {
    const orderId = seedOrder(url, "AUTHORIZED");
    const res = await ask(orderId, "How many patients?");
    assert.equal(res.status, 403);
    assert.equal(usageFor(url, orderId).length, 0);
  }),
);

for (const status of ["CAPTURED", "PAID_OUT"] as const) {
  test(
    `order in ${status} may query -> 200`,
    withEnv(async ({ url }) => {
      const orderId = seedOrder(url, status);
      const res = await ask(orderId, "How many patients?");
      assert.equal(res.status, 200);
    }),
  );
}
