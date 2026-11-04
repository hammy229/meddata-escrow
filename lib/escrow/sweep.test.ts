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

const DAY = 24 * 60 * 60 * 1000;
const T0 = "2026-01-01 00:00:00";
const at = (days: number) =>
  new Date(Date.parse("2026-01-01T00:00:00Z") + days * DAY);
const noEmit: EscrowDeps = { emit: () => {} };

async function orderAt(
  actions: ("authorize" | "deliver" | "dispute" | "capture")[],
): Promise<string> {
  const { orderId } = await createEscrowOrder(
    {
      datasetId: "ds_cardio_synthea_v1",
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
