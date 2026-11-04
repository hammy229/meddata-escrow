import { test } from "node:test";
import assert from "node:assert/strict";

import { issueMandate } from "./mandate";
import { reserveMandateSpend } from "./mandate-ledger";
import {
  isMandateRevoked,
  listMandates,
  revokeMandate,
  saveMandate,
} from "./mandate-store";
import { withAgentDb } from "./test-db";

const BUYER = "researcher@example.com";
const DATASET = {
  id: "ds_cardio_synthea_v1",
  vendorId: "vnd_demo_health",
  tags: [],
};

function issue(buyerId = BUYER, ttlMs = 3_600_000) {
  return issueMandate({
    buyerId,
    maxTotalCents: 10_000,
    allowedTags: ["cardiology"],
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  }).mandate;
}

test(
  "a saved mandate is listed with what it has spent",
  withAgentDb(async () => {
    const m = issue();
    await saveMandate(m);
    await saveMandate(issue("someone@else.test"));
    await reserveMandateSpend(m, 4000, { ...DATASET, tags: ["cardiology"] });
    const [row, ...rest] = await listMandates(BUYER);
    assert.equal(rest.length, 0);
    assert.equal(row.id, m.id);
    assert.equal(row.status, "active");
    assert.equal(row.spentCents, 4000);
    assert.equal(row.remainingCents, 6000);
    assert.deepEqual(row.allowedTags, ["cardiology"]);
  }),
);

test(
  "an expired mandate says so",
  withAgentDb(async () => {
    await saveMandate(issue());
    const later = new Date(Date.now() + 7_200_000);
    assert.equal((await listMandates(BUYER, later))[0].status, "expired");
  }),
);

test(
  "a revoked mandate refuses further spending",
  withAgentDb(async () => {
    const m = issue();
    await saveMandate(m);
    const revoked = await revokeMandate(m.id, BUYER);
    assert.equal(revoked?.status, "revoked");
    assert.equal(await isMandateRevoked(m.id), true);
    const r = await reserveMandateSpend(m, 100, {
      ...DATASET,
      tags: ["cardiology"],
    });
    assert.deepEqual(r, { ok: false, reason: "mandate revoked" });
  }),
);

test(
  "revoking twice keeps the first time",
  withAgentDb(async () => {
    const m = issue();
    await saveMandate(m);
    const first = await revokeMandate(m.id, BUYER, new Date("2026-11-01"));
    const again = await revokeMandate(m.id, BUYER, new Date("2026-11-02"));
    assert.equal(again?.revokedAt, first?.revokedAt);
  }),
);

test(
  "nobody can revoke another buyer's mandate",
  withAgentDb(async () => {
    const m = issue();
    await saveMandate(m);
    assert.equal(await revokeMandate(m.id, "someone@else.test"), undefined);
    assert.equal(await isMandateRevoked(m.id), false);
  }),
);

test(
  "a token with no stored row still works, and is not revoked",
  withAgentDb(async () => {
    assert.equal(await isMandateRevoked(issue().id), false);
  }),
);
