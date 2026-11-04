// Settling a dispute for part of the price: one side offers, the other accepts,
// and only then does money move.
import { test } from "node:test";
import assert from "node:assert/strict";

import { withAgentDb } from "../agent/test-db";
import { getOrder, listOrderEvents, openDb, type OrderRow } from "../db/client";
import { loadInsights } from "../insights/summary";
import { buildReceipt } from "./receipt";
import { vendorPayoutCents } from "./fees";
import {
  advanceEscrowOrder,
  createEscrowOrder,
  EscrowError,
  proposeSplit,
} from "./service";
import type { PayPalClient } from "../paypal/client";

const DATASET = "ds_cardio_synthea_v1"; // 4900 cents
const noEmit = { emit: () => {} };

async function disputed(): Promise<string> {
  const { orderId } = await createEscrowOrder(
    { datasetId: DATASET, buyerEmail: "buyer@example.test" },
    noEmit,
  );
  for (const action of ["authorize", "deliver", "dispute"] as const)
    await advanceEscrowOrder({ orderId, action }, noEmit);
  return orderId;
}

function read(url: string, id: string): OrderRow {
  const db = openDb(url);
  try {
    return getOrder(db, id)!;
  } finally {
    db.close();
  }
}

async function failure(p: Promise<unknown>): Promise<EscrowError> {
  try {
    await p;
  } catch (err) {
    assert.ok(err instanceof EscrowError);
    return err;
  }
  throw new Error("expected an EscrowError");
}

test(
  "an offer moves no money and is written to the audit trail",
  withAgentDb(async ({ url }) => {
    const orderId = await disputed();
    const order = await proposeSplit({
      orderId,
      captureCents: 3000,
      actor: "vendor",
      note: "Two columns were empty",
    });
    assert.equal(order.status, "DISPUTED");
    assert.equal(order.amount_cents, 4900);
    assert.equal(order.split_offer_cents, 3000);
    const db = openDb(url);
    const last = listOrderEvents(db, orderId).at(-1)!;
    db.close();
    assert.equal(last.event, "PROPOSE_SPLIT");
    assert.match(last.note ?? "", /vendor keeps \$30\.00.*\$19\.00 back/);
    assert.match(last.note ?? "", /Two columns were empty/);
  }),
);

test(
  "accepting settles the order at the offer and the money adds up",
  withAgentDb(async ({ url }) => {
    const orderId = await disputed();
    await proposeSplit({ orderId, captureCents: 3000, actor: "vendor" });
    const r = await advanceEscrowOrder(
      {
        orderId,
        action: "resolve",
        resolution: "split",
        captureCents: 3000,
        actor: "researcher",
      },
      noEmit,
    );
    assert.equal(r.escrowState, "CAPTURED");
    const row = read(url, orderId);
    assert.equal(row.amount_cents, 3000);
    assert.equal(row.refunded_cents, 1900);
    const receipt = buildReceipt(row, []);
    assert.equal(receipt.amountCents, 3000);
    assert.equal(receipt.refundedCents, 1900);
    assert.equal(receipt.vendorPayoutCents, vendorPayoutCents(3000));
    assert.equal(receipt.platformFeeCents + receipt.vendorPayoutCents, 3000);
    const db = openDb(url);
    assert.equal(loadInsights(db).refundedCents, 1900);
    db.close();
  }),
);

test(
  "nobody can accept their own offer",
  withAgentDb(async ({ url }) => {
    const orderId = await disputed();
    await proposeSplit({ orderId, captureCents: 3000, actor: "vendor" });
    const err = await failure(
      advanceEscrowOrder(
        {
          orderId,
          action: "resolve",
          resolution: "split",
          captureCents: 3000,
          actor: "vendor",
        },
        noEmit,
      ),
    );
    assert.equal(err.status, 409);
    assert.equal(read(url, orderId).status, "DISPUTED");
  }),
);

test(
  "accepting needs the current offer, so a changed offer can't slip through",
  withAgentDb(async ({ url }) => {
    const orderId = await disputed();
    const accept = (captureCents?: number) =>
      advanceEscrowOrder(
        {
          orderId,
          action: "resolve",
          resolution: "split",
          captureCents,
          actor: "researcher",
        },
        noEmit,
      );
    assert.equal((await failure(accept(3000))).code, "PRECONDITION");
    await proposeSplit({ orderId, captureCents: 3000, actor: "vendor" });
    await proposeSplit({ orderId, captureCents: 4000, actor: "vendor" });
    assert.equal((await failure(accept(3000))).status, 409);
    assert.equal((await failure(accept())).status, 409);
    assert.equal(read(url, orderId).status, "DISPUTED");
    assert.equal((await accept(4000)).escrowState, "CAPTURED");
  }),
);

test(
  "an offer must leave money on both sides of a disputed order",
  withAgentDb(async () => {
    const orderId = await disputed();
    for (const captureCents of [0, -1, 4900, 5000, 10.5, Number.NaN])
      assert.equal(
        (
          await failure(
            proposeSplit({ orderId, captureCents, actor: "vendor" }),
          )
        ).status,
        422,
      );
    const { orderId: fresh } = await createEscrowOrder(
      { datasetId: DATASET, buyerEmail: "other@example.test" },
      noEmit,
    );
    assert.equal(
      (
        await failure(
          proposeSplit({ orderId: fresh, captureCents: 100, actor: "vendor" }),
        )
      ).status,
      409,
    );
  }),
);

test(
  "live mode captures only the offer, under its own idempotency key",
  withAgentDb(async () => {
    const orderId = await disputed();
    await proposeSplit({ orderId, captureCents: 3000, actor: "vendor" });
    const db = openDb(process.env.DATABASE_URL);
    db.prepare(
      "UPDATE orders SET authorization_id = 'AUTH-1' WHERE id = ?",
    ).run(orderId);
    db.close();
    const calls: unknown[][] = [];
    const paypal = {
      captureAuthorization: async (...args: unknown[]) => {
        calls.push(args);
        return { captureId: "CAP-1", status: "COMPLETED" };
      },
    } as unknown as PayPalClient;
    delete process.env.PAYPAL_MODE;
    const r = await advanceEscrowOrder(
      {
        orderId,
        action: "resolve",
        resolution: "split",
        captureCents: 3000,
        actor: "researcher",
      },
      { paypal: () => paypal, emit: () => {} },
    );
    assert.equal(r.captureId, "CAP-1");
    assert.deepEqual(calls, [
      ["AUTH-1", { requestId: `${orderId}:split-capture`, amountCents: 3000 }],
    ]);
  }),
);
