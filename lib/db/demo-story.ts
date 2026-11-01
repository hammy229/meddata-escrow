// Demo story: a handful of orders in different escrow states, so a freshly
// reset mock-mode demo already has something to look at (a paid-out sale, a
// hold close to expiring, a dispute...). Built only through createOrder and
// advanceOrder, so every row and audit event is one the state machine allows.
//
// Runs inside the caller's transaction (see ./reset); it never opens its own.
// The catalog must already be seeded.
//
// The default buyer owns three datasets here and the second buyer none of the
// ones the agent demo reaches for, so the agent's "already owned" guard does
// not get in the way of a first run (cardio, hypertension, asthma pilot).
import type { DatabaseSync } from "node:sqlite";

import { DEFAULT_BUYER_EMAIL } from "../escrow/service";
import type { EscrowState } from "../escrow/state-machine";
import {
  advanceOrder,
  createOrder,
  getDataset,
  type OrderRow,
} from "./client";
import { recordUsage } from "./usage";

export const STORY_BUYER_EMAIL = "lab@example.edu";

/** The authorized hold is backdated this far: 29-day window, 2 days left. */
export const AUTHORIZED_AGE_DAYS = 27;

const DAY_MS = 24 * 60 * 60 * 1000;

/** SQLite CURRENT_TIMESTAMP format: UTC, "YYYY-MM-DD HH:MM:SS". */
function sqliteTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace("T", " ");
}

interface Beat {
  datasetId: string;
  buyerEmail: string;
  target: EscrowState;
  daysAgo: number;
}

const BEATS: Beat[] = [
  {
    datasetId: "ds_heart_failure_readmissions_v1",
    buyerEmail: DEFAULT_BUYER_EMAIL,
    target: "PAID_OUT",
    daysAgo: 12,
  },
  {
    datasetId: "ds_copd_exacerbations_v1",
    buyerEmail: DEFAULT_BUYER_EMAIL,
    target: "CAPTURED",
    daysAgo: 6,
  },
  {
    datasetId: "ds_diabetes_synthea_v1",
    buyerEmail: STORY_BUYER_EMAIL,
    target: "DISPUTED",
    daysAgo: 9,
  },
  {
    datasetId: "ds_diabetes_synthea_v1",
    buyerEmail: DEFAULT_BUYER_EMAIL,
    target: "AUTHORIZED",
    daysAgo: AUTHORIZED_AGE_DAYS,
  },
  {
    datasetId: "ds_cardio_synthea_v1",
    buyerEmail: STORY_BUYER_EMAIL,
    target: "VOIDED",
    daysAgo: 4,
  },
  {
    datasetId: "ds_asthma_pediatric_pilot_v1",
    buyerEmail: STORY_BUYER_EMAIL,
    target: "MATCHED",
    daysAgo: 1,
  },
];

/** Insert the sample orders and return them in their final state. */
export function seedDemoStory(
  db: DatabaseSync,
  now: Date = new Date(),
): OrderRow[] {
  return BEATS.map((beat, i) => {
    const dataset = getDataset(db, beat.datasetId);
    if (!dataset) throw new Error(`demo story: unknown dataset ${beat.datasetId}`);
    const key = `story${i + 1}`;
    let order = createOrder(db, {
      id: `ord_${key}`,
      datasetId: beat.datasetId,
      buyerEmail: beat.buyerEmail,
      amountCents: dataset.price_cents,
      paypalOrderId: `MOCK-ORDER-${key}`,
    });
    const id = order.id;
    const authorize = () =>
      advanceOrder(db, id, "AUTHORIZE", {
        authorizationId: `MOCK-AUTH-${key}`,
      });

    switch (beat.target) {
      case "PAID_OUT":
        authorize();
        advanceOrder(db, id, "DELIVER");
        advanceOrder(db, id, "CAPTURE");
        advanceOrder(db, id, "PAYOUT", { payoutBatchId: `MOCK-PAYOUT-${key}` });
        break;
      case "CAPTURED":
        authorize();
        advanceOrder(db, id, "DELIVER");
        advanceOrder(db, id, "CAPTURE");
        for (const question of [
          "How many patients are in this dataset?",
          "Average age by sex",
          "Count of patients by diagnosis",
        ])
          recordUsage(db, { orderId: id, question, chargeCents: 50 });
        break;
      case "DISPUTED":
        authorize();
        advanceOrder(db, id, "DELIVER");
        advanceOrder(
          db,
          id,
          "DISPUTE",
          undefined,
          "HbA1c column is missing for about a third of the records.",
        );
        break;
      case "AUTHORIZED":
        authorize();
        break;
      case "VOIDED":
        authorize();
        advanceOrder(db, id, "VOID");
        break;
      case "MATCHED":
        break;
    }

    // Spread the orders over the past weeks. Events share their order's
    // stamp; the AUTHORIZE event is what the authorization window reads.
    const stamp = sqliteTime(new Date(now.getTime() - beat.daysAgo * DAY_MS));
    db.prepare(
      `UPDATE orders SET created_at = ?, updated_at = ? WHERE id = ?`,
    ).run(stamp, stamp, id);
    db.prepare(`UPDATE order_events SET created_at = ? WHERE order_id = ?`).run(
      stamp,
      id,
    );
    db.prepare(`UPDATE query_usage SET created_at = ? WHERE order_id = ?`).run(
      stamp,
      id,
    );
    order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as OrderRow;
    return order;
  });
}
