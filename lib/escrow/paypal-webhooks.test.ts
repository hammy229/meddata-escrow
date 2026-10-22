// Webhook-to-escrow mapping spec, against an in-memory DB. The route test
// covers HTTP + signature handling; this pins the per-event-type decisions
// the route never reaches (create, dispute-time resolution, payload shape).
import { test } from "node:test";
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";

import {
  openDb,
  createOrder,
  advanceOrder,
  getOrder,
  listOrderEvents,
} from "../db/client";
import type { EscrowState } from "./state-machine";
import { applyPayPalWebhookEvent } from "./paypal-webhooks";

function freshDb() {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "vnd_demo_health",
    "Demo Health",
  );
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_x", "vnd_demo_health", "Test Dataset", 100);
  return db;
}

/** An order linked to PayPal order PP-1 / authorization AUTH-1, at `state`. */
function orderAt(db: DatabaseSync, state: EscrowState) {
  const order = createOrder(db, {
    datasetId: "ds_x",
    buyerEmail: "buyer@example.com",
    amountCents: 100,
    paypalOrderId: "PP-1",
    authorizationId: state === "MATCHED" ? null : "AUTH-1",
  });
  const path: Record<string, Array<Parameters<typeof advanceOrder>[2]>> = {
    MATCHED: [],
    AUTHORIZED: ["AUTHORIZE"],
    DELIVERED: ["AUTHORIZE", "DELIVER"],
    DISPUTED: ["AUTHORIZE", "DELIVER", "DISPUTE"],
  };
  for (const event of path[state]) advanceOrder(db, order.id, event);
  return getOrder(db, order.id)!;
}

let seq = 0;
const evt = (event_type: string, resource: Record<string, unknown>) => ({
  id: `WH-${++seq}`,
  event_type,
  resource,
});

test("AUTHORIZATION.CREATED authorizes a MATCHED order and stores the auth id", () => {
  const db = freshDb();
  const order = orderAt(db, "MATCHED");
  const out = applyPayPalWebhookEvent(
    db,
    evt("PAYMENT.AUTHORIZATION.CREATED", {
      id: "AUTH-NEW",
      supplementary_data: { related_ids: { order_id: "PP-1" } },
    }),
  );

  assert.equal(out.kind, "applied");
  const stored = getOrder(db, order.id)!;
  assert.equal(stored.status, "AUTHORIZED");
  assert.equal(stored.authorization_id, "AUTH-NEW");
  assert.equal(
    listOrderEvents(db, order.id).at(-1)?.note,
    "via PayPal webhook PAYMENT.AUTHORIZATION.CREATED",
  );
  db.close();
});

test("AUTHORIZATION.CREATED on an already-authorized order is record-only", () => {
  const db = freshDb();
  const order = orderAt(db, "AUTHORIZED");
  const out = applyPayPalWebhookEvent(
    db,
    evt("PAYMENT.AUTHORIZATION.CREATED", { id: "AUTH-1" }),
  );
  assert.deepEqual(
    { kind: out.kind, state: getOrder(db, order.id)!.status },
    { kind: "recorded", state: "AUTHORIZED" },
  );
  db.close();
});

test("a void during a dispute resolves the dispute as RESOLVE_VOID", () => {
  const db = freshDb();
  const order = orderAt(db, "DISPUTED");
  const out = applyPayPalWebhookEvent(
    db,
    evt("PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH-1" }),
  );
  assert.equal(out.kind, "applied");
  assert.equal(out.kind === "applied" && out.event, "RESOLVE_VOID");
  assert.equal(getOrder(db, order.id)!.status, "VOIDED");
  db.close();
});

test("a capture during a dispute resolves the dispute as RESOLVE_CAPTURE", () => {
  const db = freshDb();
  const order = orderAt(db, "DISPUTED");
  const out = applyPayPalWebhookEvent(
    db,
    evt("PAYMENT.CAPTURE.COMPLETED", {
      id: "CAP-1",
      supplementary_data: { related_ids: { authorization_id: "AUTH-1" } },
    }),
  );
  assert.equal(out.kind === "applied" && out.event, "RESOLVE_CAPTURE");
  assert.equal(getOrder(db, order.id)!.status, "CAPTURED");
  db.close();
});

test("DISPUTE.CREATED finds the order through disputed_transactions", () => {
  const db = freshDb();
  const order = orderAt(db, "DELIVERED");
  const out = applyPayPalWebhookEvent(
    db,
    evt("CUSTOMER.DISPUTE.CREATED", {
      id: "PP-D-1",
      disputed_transactions: [{ seller_transaction_id: "AUTH-1" }],
    }),
  );
  assert.equal(out.kind, "applied");
  assert.equal(getOrder(db, order.id)!.status, "DISPUTED");
  db.close();
});

test("alert types (e.g. CAPTURE.REFUNDED) are recorded, never applied", () => {
  const db = freshDb();
  const order = orderAt(db, "DELIVERED");
  const out = applyPayPalWebhookEvent(
    db,
    evt("PAYMENT.CAPTURE.REFUNDED", { id: "AUTH-1" }),
  );
  assert.equal(out.kind, "recorded");
  assert.equal(getOrder(db, order.id)!.status, "DELIVERED");
  db.close();
});

test("an event without id or event_type is ignored and not stored", () => {
  const db = freshDb();
  for (const payload of [
    null,
    {},
    { id: "WH-x" },
    { event_type: "PAYMENT.CAPTURE.COMPLETED" },
  ]) {
    const out = applyPayPalWebhookEvent(db, payload);
    assert.equal(out.kind, "ignored");
  }
  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM paypal_webhook_events`)
    .get() as { n: number };
  assert.equal(n.n, 0);
  db.close();
});

test("a replay of an applied event is a duplicate and moves nothing", () => {
  const db = freshDb();
  const order = orderAt(db, "AUTHORIZED");
  const payload = evt("PAYMENT.AUTHORIZATION.VOIDED", { id: "AUTH-1" });
  assert.equal(applyPayPalWebhookEvent(db, payload).kind, "applied");
  const events = listOrderEvents(db, order.id).length;

  assert.equal(applyPayPalWebhookEvent(db, payload).kind, "duplicate");
  assert.equal(listOrderEvents(db, order.id).length, events);
  db.close();
});
