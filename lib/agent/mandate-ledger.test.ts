import { test } from "node:test";
import assert from "node:assert/strict";

import { issueMandate, type Mandate } from "./mandate";
import {
  linkMandateSpend,
  releaseMandateSpend,
  reserveMandateSpend,
  spentUnderMandate,
} from "./mandate-ledger";
import { withAgentDb } from "./test-db";
import { advanceOrder, createOrder, openDb } from "../db/client";

const CARDIO = {
  id: "ds_cardio_synthea_v1",
  vendorId: "vnd_demo_health",
  tags: ["cardiology"],
};

function mandate(maxTotalCents = 10_000): Mandate {
  return issueMandate({
    buyerId: "researcher@example.com",
    maxTotalCents,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  }).mandate;
}

function reserved(r: Awaited<ReturnType<typeof reserveMandateSpend>>): string {
  assert.ok(r.ok);
  return r.reservationId;
}

test(
  "a reservation counts as spent and stays in the database",
  withAgentDb(async () => {
    const m = mandate();
    reserved(await reserveMandateSpend(m, 4000, CARDIO));
    assert.equal(await spentUnderMandate(m.id), 4000);
    assert.equal(await spentUnderMandate("mdt_other"), 0);
  }),
);

test(
  "concurrent reservations cannot pass the total together",
  withAgentDb(async () => {
    const m = mandate(6000);
    const results = await Promise.all(
      [1, 2, 3].map(() => reserveMandateSpend(m, 4000, CARDIO)),
    );
    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(await spentUnderMandate(m.id), 4000);
    const denied = results.find((r) => !r.ok);
    assert.ok(denied && !denied.ok);
    assert.match(denied.reason, /remaining 2000 cents/);
  }),
);

test(
  "releasing a reservation gives the budget back",
  withAgentDb(async () => {
    const m = mandate();
    await releaseMandateSpend(
      reserved(await reserveMandateSpend(m, 4000, CARDIO)),
    );
    assert.equal(await spentUnderMandate(m.id), 0);
  }),
);

test(
  "a cancelled or voided order gives its budget back",
  withAgentDb(async ({ url }) => {
    const m = mandate();
    const id = reserved(await reserveMandateSpend(m, 4900, CARDIO));
    const db = openDb(url);
    const order = createOrder(db, {
      datasetId: CARDIO.id,
      buyerEmail: "researcher@example.com",
      amountCents: 4900,
    });
    db.close();
    await linkMandateSpend(id, order.id);
    assert.equal(await spentUnderMandate(m.id), 4900);

    const db2 = openDb(url);
    advanceOrder(db2, order.id, "CANCEL");
    db2.close();
    assert.equal(await spentUnderMandate(m.id), 0);
  }),
);
