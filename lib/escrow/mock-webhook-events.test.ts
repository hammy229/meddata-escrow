// The simulator's payloads must drive the real webhook processor. Each test
// uses a seeded temp-file DB (processPayPalWebhookEvent opens its own
// connection from DATABASE_URL).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import {
  openDb,
  createOrder,
  advanceOrder,
  getOrder,
  listOrderEvents,
  type OrderRow,
} from "../db/client";
import type { EscrowEvent } from "./state-machine";
import { processPayPalWebhookEvent } from "./paypal-webhooks";
import {
  MOCK_WEBHOOK_KINDS,
  buildMockWebhookEvent,
  mockWebhookFits,
} from "./mock-webhook-events";

/** Run `fn` with an order moved through `path`, on an isolated temp DB. */
function withOrder(
  path: EscrowEvent[],
  fn: (order: OrderRow) => void,
  opts: { authorizationId?: string | null } = {},
): () => void {
  return () => {
    const file = join(tmpdir(), `meddata-mockwh-${randomUUID()}.sqlite`);
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${file}`;
    try {
      const db = openDb();
      db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
        "vnd_demo_health",
        "Demo Health",
      );
      db.prepare(
        `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
      ).run("ds_x", "vnd_demo_health", "Test Dataset", 4900);
      const order = createOrder(db, {
        datasetId: "ds_x",
        buyerEmail: "buyer@example.com",
        amountCents: 4900,
        paypalOrderId: "MOCK-ORDER-1",
        ...(opts.authorizationId === null
          ? {}
          : { authorizationId: opts.authorizationId ?? "MOCK-AUTH-1" }),
      });
      for (const e of path) advanceOrder(db, order.id, e);
      const current = getOrder(db, order.id)!;
      db.close();
      fn(current);
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
      rmSync(file, { force: true });
    }
  };
}

function stateOf(id: string) {
  const db = openDb();
  try {
    return {
      status: getOrder(db, id)!.status,
      events: listOrderEvents(db, id),
    };
  } finally {
    db.close();
  }
}

test(
  "capture completed captures a delivered order",
  withOrder(["AUTHORIZE", "DELIVER"], (order) => {
    const out = processPayPalWebhookEvent(
      buildMockWebhookEvent("capture_completed", order),
    );
    assert.equal(out.kind, "applied");
    const { status, events } = stateOf(order.id);
    assert.equal(status, "CAPTURED");
    assert.equal(
      events.at(-1)?.note,
      "via PayPal webhook PAYMENT.CAPTURE.COMPLETED",
    );
  }),
);

test(
  "authorization voided voids an authorized order",
  withOrder(["AUTHORIZE"], (order) => {
    const out = processPayPalWebhookEvent(
      buildMockWebhookEvent("authorization_voided", order),
    );
    assert.equal(out.kind, "applied");
    assert.equal(stateOf(order.id).status, "VOIDED");
  }),
);

test(
  "dispute created opens a dispute on a delivered order",
  withOrder(["AUTHORIZE", "DELIVER"], (order) => {
    const out = processPayPalWebhookEvent(
      buildMockWebhookEvent("dispute_created", order),
    );
    assert.equal(out.kind, "applied");
    assert.equal(stateOf(order.id).status, "DISPUTED");
  }),
);

test(
  "a repeated event id is a duplicate and changes nothing",
  withOrder(["AUTHORIZE"], (order) => {
    const evt = buildMockWebhookEvent("authorization_voided", order);
    assert.equal(processPayPalWebhookEvent(evt).kind, "applied");
    assert.equal(processPayPalWebhookEvent(evt).kind, "duplicate");
    assert.equal(stateOf(order.id).events.length, 3);
  }),
);

test(
  "an event that is illegal from the current state is ignored, not forced",
  withOrder([], (order) => {
    const out = processPayPalWebhookEvent(
      buildMockWebhookEvent("capture_completed", order),
    );
    assert.equal(out.kind, "ignored");
    assert.equal(stateOf(order.id).status, "MATCHED");
  }),
);

test("payloads look like PayPal events and get fresh ids", () => {
  const order = {
    id: "ord_1",
    paypal_order_id: "MOCK-ORDER-1",
    authorization_id: "MOCK-AUTH-1",
    amount_cents: 4900,
  };
  const now = new Date("2026-10-29T12:00:00Z");
  for (const { kind, eventType } of MOCK_WEBHOOK_KINDS) {
    const a = buildMockWebhookEvent(kind, order, { now });
    const b = buildMockWebhookEvent(kind, order, { now });
    assert.equal(a.event_type, eventType);
    assert.equal(a.create_time, "2026-10-29T12:00:00.000Z");
    assert.match(String(a.id), /^WH-MOCK-/);
    assert.notEqual(a.id, b.id);
    assert.equal(typeof a.resource, "object");
  }
  const capture = buildMockWebhookEvent("capture_completed", order);
  assert.deepEqual((capture.resource as { amount: unknown }).amount, {
    currency_code: "USD",
    value: "49.00",
  });
  assert.equal(
    buildMockWebhookEvent("capture_completed", order, { eventId: "WH-FIXED" })
      .id,
    "WH-FIXED",
  );
});

const PATHS: Record<string, EscrowEvent[]> = {
  MATCHED: [],
  AUTHORIZED: ["AUTHORIZE"],
  DELIVERED: ["AUTHORIZE", "DELIVER"],
  DISPUTED: ["AUTHORIZE", "DISPUTE"],
  CAPTURED: ["AUTHORIZE", "DELIVER", "CAPTURE"],
  PAID_OUT: ["AUTHORIZE", "DELIVER", "CAPTURE", "PAYOUT"],
  VOIDED: ["AUTHORIZE", "VOID"],
  CANCELLED: ["CANCEL"],
};

// capture_refunded never moves an order (it is always just recorded), so only
// the kinds that can change state are compared with the processor.
for (const { kind } of MOCK_WEBHOOK_KINDS.filter(
  (k) => k.kind !== "capture_refunded",
)) {
  for (const [status, path] of Object.entries(PATHS)) {
    test(
      `mockWebhookFits(${kind}, ${status}) agrees with the processor`,
      withOrder(path, (order) => {
        assert.equal(order.status, status);
        const out = processPayPalWebhookEvent(
          buildMockWebhookEvent(kind, order),
        );
        assert.equal(mockWebhookFits(kind, status), out.kind === "applied");
      }),
    );
  }
}

test("mockWebhookFits is false for an unknown status", () => {
  assert.equal(mockWebhookFits("capture_completed", "NOPE"), false);
});

test(
  "replaying the identical payload is a duplicate",
  withOrder(["AUTHORIZE", "DELIVER"], (order) => {
    const evt = buildMockWebhookEvent("capture_completed", order);
    const replay = JSON.parse(JSON.stringify(evt));
    assert.equal(processPayPalWebhookEvent(evt).kind, "applied");
    assert.equal(processPayPalWebhookEvent(replay).kind, "duplicate");
    assert.equal(stateOf(order.id).status, "CAPTURED");
  }),
);

test(
  "authorization created authorizes a matched order and stores the new id",
  withOrder(
    [],
    (order) => {
      assert.equal(order.authorization_id, null);
      const evt = buildMockWebhookEvent("authorization_created", order);
      const resource = evt.resource as {
        id: string;
        supplementary_data: { related_ids: { order_id: string } };
      };
      assert.match(resource.id, /^MOCK-AUTH-/);
      assert.equal(
        resource.supplementary_data.related_ids.order_id,
        "MOCK-ORDER-1",
      );

      const out = processPayPalWebhookEvent(evt);
      assert.equal(out.kind, "applied");
      const db = openDb();
      try {
        const after = getOrder(db, order.id)!;
        assert.equal(after.status, "AUTHORIZED");
        assert.equal(after.authorization_id, resource.id);
      } finally {
        db.close();
      }
      assert.equal(processPayPalWebhookEvent(evt).kind, "duplicate");
    },
    { authorizationId: null },
  ),
);

test(
  "capture refunded is recorded without moving the order",
  withOrder(["AUTHORIZE", "DELIVER", "CAPTURE"], (order) => {
    const out = processPayPalWebhookEvent(
      buildMockWebhookEvent("capture_refunded", order),
    );
    assert.equal(out.kind, "recorded");
    assert.equal(stateOf(order.id).status, "CAPTURED");
  }),
);
