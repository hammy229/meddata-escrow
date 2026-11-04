// Delivery audits are stored once per order, on SQLite and PostgreSQL alike.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { openDb } from "./client";
import {
  postgresConnection,
  sqliteConnection,
  type AppDatabase,
} from "./connection";
import { migratePostgres } from "./migrations";
import { seedDatabase } from "./seed";
import { resetDemoData } from "./reset";
import { createOrder, saveDeliveryAudit, getDeliveryAudit } from "./store";
import type { FitnessReport, ListingClaims } from "../fitness/types";

const DATASET = "ds_als_survival_curated_v1";
const claims: ListingClaims = {
  subjects: 400,
  records: 400,
  eventRatePct: 60,
  coveragePct: { age: 99 },
  uniqueSubjects: true,
};
const report: FitnessReport = {
  datasetId: DATASET,
  stage: "delivery",
  synthetic: true,
  verdict: "fail",
  findings: [],
  disclaimer: "screen, not proof",
  methodVersion: 1,
};
const input = (orderId: string, over: Record<string, unknown> = {}) => ({
  orderId,
  datasetId: DATASET,
  verdict: "fail" as const,
  blocking: true,
  fingerprint: "abc123",
  claims,
  report,
  ...over,
});

async function exercise(db: AppDatabase) {
  const order = await createOrder(db, {
    datasetId: DATASET,
    buyerEmail: "b@example.test",
    amountCents: 2900,
  });
  assert.equal(await getDeliveryAudit(db, order.id), undefined);
  assert.equal(await saveDeliveryAudit(db, input(order.id)), true);
  const stored = (await getDeliveryAudit(db, order.id))!;
  assert.equal(stored.orderId, order.id);
  assert.equal(stored.verdict, "fail");
  assert.equal(stored.blocking, true);
  assert.equal(stored.fingerprint, "abc123");
  assert.deepEqual(stored.claims, claims);
  assert.deepEqual(stored.report, report);
  assert.ok(stored.createdAt.length > 0);

  // The first audit stays; a second save changes nothing.
  assert.equal(
    await saveDeliveryAudit(
      db,
      input(order.id, { verdict: "pass", blocking: false, fingerprint: "zzz" }),
    ),
    false,
  );
  const again = (await getDeliveryAudit(db, order.id))!;
  assert.equal(again.verdict, "fail");
  assert.equal(again.blocking, true);
  assert.equal(again.fingerprint, "abc123");

  // Audits with nothing to compare store nulls.
  const other = await createOrder(db, {
    datasetId: DATASET,
    buyerEmail: "c@example.test",
    amountCents: 2900,
  });
  await saveDeliveryAudit(
    db,
    input(other.id, {
      verdict: "not_applicable",
      blocking: false,
      fingerprint: null,
      claims: null,
      report: null,
    }),
  );
  const na = (await getDeliveryAudit(db, other.id))!;
  assert.equal(na.blocking, false);
  assert.equal(na.fingerprint, null);
  assert.equal(na.claims, null);
  assert.equal(na.report, null);
}

test("delivery audits round trip on SQLite", async () => {
  const raw = openDb(":memory:");
  try {
    seedDatabase(raw);
    await exercise(sqliteConnection(raw));
  } finally {
    raw.close();
  }
});

test("delivery audits round trip on PostgreSQL", async () => {
  const pg = await PGlite.create();
  const db = postgresConnection({
    query: async (sql, params) => {
      const result =
        params === undefined
          ? (await pg.exec(sql)).at(-1)!
          : await pg.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
  });
  try {
    await migratePostgres(db);
    await db
      .prepare("INSERT INTO vendors (id, name) VALUES (?, ?)")
      .run("vendor", "Test Provider");
    await db
      .prepare(
        "INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)",
      )
      .run(DATASET, "vendor", "Curated", 2900);
    await exercise(db);
  } finally {
    await pg.close();
  }
});

test("demo reset clears delivery audits", async () => {
  const raw = openDb(":memory:");
  try {
    seedDatabase(raw);
    const db = sqliteConnection(raw);
    const order = await createOrder(db, {
      datasetId: DATASET,
      buyerEmail: "b@example.test",
      amountCents: 2900,
    });
    await saveDeliveryAudit(db, input(order.id));
    resetDemoData(raw);
    const n = raw
      .prepare("SELECT COUNT(*) AS n FROM delivery_audits")
      .get() as { n: number };
    assert.equal(n.n, 0);
  } finally {
    raw.close();
  }
});
