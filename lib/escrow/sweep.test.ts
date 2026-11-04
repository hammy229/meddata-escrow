import { test } from "node:test";
import assert from "node:assert/strict";

import { withAgentDb } from "../agent/test-db";
import { getOrder, listOrderEvents, openDb } from "../db/client";
import {
  advanceEscrowOrder,
  createEscrowOrder,
  type EscrowDeps,
} from "./service";
import { escrowDeadline, INSPECTION_DAYS, sweepEscrow } from "./sweep";
import { PGlite } from "@electric-sql/pglite";
import { postgresConnection } from "../db/connection";
import { migratePostgres } from "../db/migrations";
import {
  advanceOrder,
  createOrder as createStoreOrder,
  listOrderEvents as listStoreEvents,
} from "../db/store";

const CLEAN = "ds_als_survival_motorneuron_v1";
const CURATED = "ds_als_survival_curated_v1";

function setAudit(url: string, orderId: string, sql: string) {
  const db = openDb(url);
  db.prepare(sql).run(orderId);
  db.close();
}

const DAY = 24 * 60 * 60 * 1000;
const T0 = "2026-01-01 00:00:00";
const at = (days: number) =>
  new Date(Date.parse("2026-01-01T00:00:00Z") + days * DAY);
const noEmit: EscrowDeps = { emit: () => {} };

async function orderAt(
  actions: ("authorize" | "deliver" | "dispute" | "capture")[],
  datasetId = "ds_cardio_synthea_v1",
): Promise<string> {
  const { orderId } = await createEscrowOrder(
    {
      datasetId,
      buyerEmail: `b${Math.random()}@example.test`,
    },
    noEmit,
  );
  for (const action of actions)
    await advanceEscrowOrder({ orderId, action }, noEmit);
  return orderId;
}

/** Pretend the order's events all happened at T0. */
function backdate(url: string, orderId: string, stamp = T0) {
  const db = openDb(url);
  db.prepare("UPDATE order_events SET created_at = ? WHERE order_id = ?").run(
    stamp,
    orderId,
  );
  db.close();
}

function statusOf(url: string, orderId: string) {
  const db = openDb(url);
  try {
    return getOrder(db, orderId)!.status;
  } finally {
    db.close();
  }
}

test("delivered data is released after the inspection window", () => {
  const events = [
    { event: "AUTHORIZE", created_at: T0 },
    { event: "DELIVER", created_at: T0 },
  ];
  const d = escrowDeadline("DELIVERED", events, at(2));
  assert.equal(d?.action, "release");
  assert.equal(d?.dueAt, at(INSPECTION_DAYS).toISOString());
  assert.equal(d?.daysLeft, INSPECTION_DAYS - 2);
});

test("late delivery can't push the deadline past the end of the hold", () => {
  const d = escrowDeadline(
    "DELIVERED",
    [
      { event: "AUTHORIZE", created_at: T0 },
      { event: "DELIVER", created_at: "2026-01-26 00:00:00" },
    ],
    at(26),
  );
  assert.equal(d?.dueAt, at(28).toISOString());
});

test("only held, undisputed orders have a deadline", () => {
  const events = [{ event: "AUTHORIZE", created_at: T0 }];
  assert.equal(escrowDeadline("AUTHORIZED", events, at(0))?.action, "refund");
  for (const status of ["MATCHED", "DISPUTED", "CAPTURED", "VOIDED"])
    assert.equal(escrowDeadline(status, events, at(0)), null, status);
  assert.equal(escrowDeadline("AUTHORIZED", [], at(0)), null);
});

test(
  "the sweep releases a silent buyer's order and writes down why",
  withAgentDb(async ({ url }) => {
    const orderId = await orderAt(["authorize", "deliver"]);
    backdate(url, orderId);
    const before = await sweepEscrow({ now: at(6), deps: noEmit });
    assert.deepEqual(before.released, []);
    assert.equal(statusOf(url, orderId), "DELIVERED");

    const after = await sweepEscrow({ now: at(7), deps: noEmit });
    assert.deepEqual(after.released, [orderId]);
    assert.equal(statusOf(url, orderId), "CAPTURED");
    const db = openDb(url);
    const last = listOrderEvents(db, orderId).at(-1)!;
    db.close();
    assert.match(last.note ?? "", /did not respond within 7 days/);
  }),
);

test(
  "the sweep refunds the buyer when the vendor never delivers",
  withAgentDb(async ({ url }) => {
    const orderId = await orderAt(["authorize"]);
    backdate(url, orderId);
    assert.deepEqual(
      (await sweepEscrow({ now: at(27), deps: noEmit })).refunded,
      [],
    );
    assert.deepEqual(
      (await sweepEscrow({ now: at(28), deps: noEmit })).refunded,
      [orderId],
    );
    assert.equal(statusOf(url, orderId), "VOIDED");
  }),
);

test(
  "a dispute is flagged but never moved",
  withAgentDb(async ({ url }) => {
    const orderId = await orderAt(["authorize", "deliver", "dispute"]);
    backdate(url, orderId);
    const r = await sweepEscrow({ now: at(28), deps: noEmit });
    assert.deepEqual(r.needsReview, [orderId]);
    assert.deepEqual([...r.released, ...r.refunded], []);
    assert.equal(statusOf(url, orderId), "DISPUTED");
  }),
);

test(
  "running again changes nothing, and fresh or settled orders are left alone",
  withAgentDb(async ({ url }) => {
    const due = await orderAt(["authorize", "deliver"]);
    const fresh = await orderAt(["authorize", "deliver"]);
    const settled = await orderAt(["authorize", "deliver", "capture"]);
    backdate(url, due);
    backdate(url, settled);
    const now = new Date();
    await sweepEscrow({ now, deps: noEmit });
    assert.equal(statusOf(url, due), "CAPTURED");
    assert.equal(statusOf(url, fresh), "DELIVERED");
    const again = await sweepEscrow({ now, deps: noEmit });
    assert.deepEqual(again.released, []);
    assert.deepEqual(again.failed, []);
  }),
);

test(
  "one failed move is reported and the rest still run",
  withAgentDb(async ({ url }) => {
    const a = await orderAt(["authorize", "deliver"]);
    const b = await orderAt(["authorize", "deliver"]);
    backdate(url, a);
    backdate(url, b);
    assert.equal(
      (await sweepEscrow({ now: at(8), deps: noEmit })).released.length,
      2,
    );

    const c = await orderAt(["authorize", "deliver"]);
    backdate(url, c);
    delete process.env.PAYPAL_MODE; // live mode with no authorization id
    const live = await sweepEscrow({ now: at(8), deps: noEmit });
    assert.equal(live.failed.length, 1);
    assert.equal(live.failed[0].orderId, c);
    assert.equal(statusOf(url, c), "DELIVERED");
  }),
);

test("a release is held back when the audit blocks, and the sweep says why", withAgentDb(async ({ url }) => {
  const orderId = await orderAt(["authorize", "deliver"], CLEAN);
  setAudit(url, orderId, "UPDATE delivery_audits SET blocking = 1, verdict = 'fail' WHERE order_id = ?");
  backdate(url, orderId);
  const first = await sweepEscrow({ now: at(8), deps: noEmit });
  assert.deepEqual(first.released, []);
  assert.deepEqual(first.failed, []);
  assert.equal(first.blocked.length, 1);
  assert.equal(first.blocked[0].orderId, orderId);
  assert.match(first.blocked[0].reason, /audit/i);
  assert.equal(statusOf(url, orderId), "DELIVERED");
  // Again: still not captured, still not a failure.
  const second = await sweepEscrow({ now: at(9), deps: noEmit });
  assert.deepEqual([...second.released, ...second.failed], []);
  assert.equal(second.blocked.length, 1);
  assert.equal(statusOf(url, orderId), "DELIVERED");
}));

test("an inconclusive audit is never released automatically", withAgentDb(async ({ url }) => {
  const orderId = await orderAt(["authorize", "deliver"], CLEAN);
  setAudit(url, orderId, "UPDATE delivery_audits SET verdict = 'inconclusive' WHERE order_id = ?");
  backdate(url, orderId);
  const r = await sweepEscrow({ now: at(8), deps: noEmit });
  assert.deepEqual(r.released, []);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.blocked.map((b) => b.orderId), [orderId]);
  assert.match(r.blocked[0].reason, /could not reach a verdict/);
  assert.equal(statusOf(url, orderId), "DELIVERED");
}));

test("an audited dataset with no audit on file is not released automatically", withAgentDb(async ({ url }) => {
  const orderId = await orderAt(["authorize", "deliver"], CLEAN);
  setAudit(url, orderId, "DELETE FROM delivery_audits WHERE order_id = ?");
  backdate(url, orderId);
  const r = await sweepEscrow({ now: at(8), deps: noEmit });
  assert.deepEqual(r.released, []);
  assert.deepEqual(r.blocked.map((b) => b.orderId), [orderId]);
  assert.match(r.blocked[0].reason, /no delivery audit/);
}));

test("a clean audit, a warning-only audit and an unaudited listing still release", withAgentDb(async ({ url }) => {
  const clean = await orderAt(["authorize", "deliver"], CLEAN);
  const warned = await orderAt(["authorize", "deliver"], CLEAN);
  setAudit(url, warned, "UPDATE delivery_audits SET verdict = 'warn' WHERE order_id = ?");
  const cardio = await orderAt(["authorize", "deliver"]);
  for (const id of [clean, warned, cardio]) backdate(url, id);
  const r = await sweepEscrow({ now: at(8), deps: noEmit });
  assert.deepEqual(new Set(r.released), new Set([clean, warned, cardio]));
  assert.deepEqual(r.blocked, []);
}));

test("a not-yet-due blocked order is not reported", withAgentDb(async ({ url }) => {
  const orderId = await orderAt(["authorize", "deliver"], CLEAN);
  setAudit(url, orderId, "UPDATE delivery_audits SET blocking = 1 WHERE order_id = ?");
  backdate(url, orderId);
  assert.deepEqual((await sweepEscrow({ now: at(2), deps: noEmit })).blocked, []);
}));

test("an audit-disputed order is flagged for review when its hold runs out, never moved", withAgentDb(async ({ url }) => {
  const orderId = await orderAt(["authorize", "deliver"], CURATED);
  assert.equal(statusOf(url, orderId), "DISPUTED");
  backdate(url, orderId);
  const r = await sweepEscrow({ now: at(28), deps: noEmit });
  assert.deepEqual(r.needsReview, [orderId]);
  assert.deepEqual([...r.released, ...r.refunded, ...r.failed, ...r.blocked], []);
  assert.equal(statusOf(url, orderId), "DISPUTED");
}));

test("escrowDeadline promises no release while the audit holds it back", () => {
  const events = [
    { event: "AUTHORIZE", created_at: T0 },
    { event: "DELIVER", created_at: T0 },
  ];
  assert.equal(escrowDeadline("DELIVERED", events, at(1), { releaseBlocked: true }), null);
  assert.equal(escrowDeadline("DELIVERED", events, at(1), { releaseBlocked: false })?.action, "release");
  const authorized = [{ event: "AUTHORIZE", created_at: T0 }];
  assert.equal(escrowDeadline("AUTHORIZED", authorized, at(1), { releaseBlocked: true })?.action, "refund");
});

test("Postgres-format timestamps parse in escrowDeadline", async () => {
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
    await db.prepare("INSERT INTO vendors (id, name) VALUES (?, ?)").run("v", "V");
    await db
      .prepare("INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)")
      .run("d", "v", "D", 2900);
    const order = await createStoreOrder(db, { datasetId: "d", buyerEmail: "b@example.test", amountCents: 2900 });
    await advanceOrder(db, order.id, "AUTHORIZE", { authorizationId: "A" });
    await advanceOrder(db, order.id, "DELIVER");
    const events = await listStoreEvents(db, order.id);
    assert.match(events[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}(:?\d{2})?$/);
    const deliveredAt = Date.parse(events.find((e) => e.event === "DELIVER")!.created_at.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
    const d = escrowDeadline("DELIVERED", events, new Date(deliveredAt));
    assert.equal(d?.action, "release");
    assert.equal(d?.dueAt, new Date(deliveredAt + INSPECTION_DAYS * DAY).toISOString());
    // A non-UTC session offset reads the same instant.
    const shifted = events.map((e) => ({ ...e, created_at: "2026-01-01 00:00:00.5-06" }));
    assert.equal(escrowDeadline("DELIVERED", shifted, at(0))?.dueAt, new Date(Date.parse("2026-01-01T06:00:00.5Z") + INSPECTION_DAYS * DAY).toISOString());
  } finally {
    await pg.close();
  }
});
