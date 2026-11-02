import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { postgresConnection, transaction } from "./connection";
import { migratePostgres } from "./migrations";
import {
  createOrder,
  getOrder,
  advanceOrder,
  listOrderEvents,
  listOrders,
  recordUsage,
  queryCapStatus,
  summarizeOrders,
  recordWebhookEvent,
  listDatasets,
  updateDatasetPrice,
} from "./store";
import { applyPayPalWebhookEvent } from "../escrow/paypal-webhooks";
import { postgresConfig, postgresSql } from "../postgres/config";

test("PostgreSQL parameters and TLS configuration", () => {
  assert.equal(
    postgresSql("SELECT '?' AS literal, ? AS param -- ?\n, ? AS another"),
    "SELECT '?' AS literal, $1 AS param -- ?\n, $2 AS another",
  );
  assert.throws(() => postgresConfig("https://example.com/db"));
  assert.throws(() =>
    postgresConfig("postgres://a:b@remote.example/db?sslmode=disable"),
  );
  const config = postgresConfig(
    "postgres://u:p%40ss@db.example/research?sslmode=require&options=unsafe",
  );
  assert.equal(config.password, "p@ss");
  assert.equal(
    typeof config.ssl === "object" && config.ssl.rejectUnauthorized,
    true,
  );
  assert.equal(
    postgresConfig("postgres://a:b@localhost/db?sslmode=disable", {
      allowLocal: true,
    }).ssl,
    false,
  );
});

test("app repository executes migrations and escrow/billing transactions on PostgreSQL", async () => {
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
    await migratePostgres(db);
    await db
      .prepare("INSERT INTO vendors (id, name, payout_email) VALUES (?, ?, ?)")
      .run("vendor", "Test Provider", "payout@example.test");
    await db
      .prepare(
        "INSERT INTO accounts (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      )
      .run("account", "user@example.test", "Test User", "hash", "researcher");
    await db
      .prepare(
        "INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)",
      )
      .run("dataset", "vendor", "Test cohort", 4900);
    const order = await createOrder(db, {
      datasetId: "dataset",
      buyerEmail: "user@example.test",
      accountId: "account",
      amountCents: 4900,
      queryCapCents: 100,
      paypalOrderId: "PP-1",
    });
    assert.equal(order.account_id, "account");
    await assert.rejects(advanceOrder(db, order.id, "PAYOUT"));
    assert.equal((await getOrder(db, order.id))?.status, "MATCHED");
    await advanceOrder(db, order.id, "AUTHORIZE", {
      authorizationId: "AUTH-1",
    });
    await advanceOrder(db, order.id, "DELIVER");
    await recordUsage(db, {
      orderId: order.id,
      question: "How many?",
      chargeCents: 50,
    });
    assert.deepEqual(await queryCapStatus(db, order, 50), {
      exceeded: false,
      spentCents: 50,
      capCents: 100,
    });
    const event = {
      id: "WH-1",
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      resource: {
        id: "CAP-1",
        supplementary_data: { related_ids: { authorization_id: "AUTH-1" } },
      },
    };
    assert.equal((await applyPayPalWebhookEvent(db, event)).kind, "applied");
    assert.equal((await applyPayPalWebhookEvent(db, event)).kind, "duplicate");
    await advanceOrder(db, order.id, "PAYOUT", { payoutBatchId: "BATCH-1" });
    assert.equal((await summarizeOrders(db)).paidOutCents, 4900);
    assert.equal((await listOrderEvents(db, order.id)).length, 5);
    assert.equal(
      (await listOrders(db, { buyerEmail: "user@example.test" })).length,
      1,
    );
    assert.equal((await listDatasets(db)).length, 1);
    assert.equal(
      (await updateDatasetPrice(db, "dataset", 5000))?.priceCents,
      5000,
    );
    assert.equal(
      await recordWebhookEvent(db, { id: "WH-1", eventType: "duplicate" }),
      false,
    );
    await assert.rejects(
      transaction(db, async () => {
        await db
          .prepare("UPDATE datasets SET price_cents = ? WHERE id = ?")
          .run(100, "dataset");
        throw new Error("rollback");
      }),
    );
    assert.equal((await listDatasets(db))[0].priceCents, 5000);
  } finally {
    await pg.close();
  }
});

test("migrating an older database adds the dataset columns it lacks", async () => {
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
  const columns = async () =>
    (
      (await db
        .prepare(
          "SELECT column_name FROM information_schema.columns WHERE table_name = 'datasets'",
        )
        .all()) as { column_name: string }[]
    ).map((c) => c.column_name);
  try {
    await migratePostgres(db);
    await db.exec(
      "ALTER TABLE datasets DROP COLUMN tags_json, DROP COLUMN source_connection_id",
    );
    assert.ok(!(await columns()).includes("tags_json"));
    await migratePostgres(db);
    const after = await columns();
    assert.ok(after.includes("tags_json"));
    assert.ok(after.includes("source_connection_id"));
  } finally {
    await pg.close();
  }
});
