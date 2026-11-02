import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkSpend,
  issueMandate,
  verifyMandate,
  type Mandate,
} from "./mandate";

const SECRET = "test-secret";
const NOW = new Date("2026-11-02T12:00:00.000Z");
const LATER = new Date("2026-11-03T12:00:00.000Z");

const DS = {
  id: "ds_cardio_synthea_v1",
  vendorId: "vnd_demo_health",
  tags: ["cardiology", "synthetic"],
};

function issue(extra: Record<string, unknown> = {}) {
  return issueMandate(
    {
      buyerId: "researcher@example.com",
      maxTotalCents: 10_000,
      maxPerOrderCents: 6_000,
      expiresAt: LATER.toISOString(),
      ...extra,
    },
    { secret: SECRET, now: NOW },
  );
}

test("issueMandate returns a token and the normalized mandate", () => {
  const { token, mandate } = issue();
  assert.match(token, /^[\w-]+\.[\w-]+$/);
  assert.equal(mandate.buyerId, "researcher@example.com");
  assert.equal(mandate.maxTotalCents, 10_000);
  assert.equal(mandate.maxPerOrderCents, 6_000);
  assert.match(mandate.id, /^mdt_/);
  assert.equal(mandate.issuedAt, NOW.toISOString());
});

test("maxPerOrderCents defaults to maxTotalCents", () => {
  const { mandate } = issue({ maxPerOrderCents: undefined });
  assert.equal(mandate.maxPerOrderCents, 10_000);
});

test("verifyMandate accepts a fresh token", () => {
  const { token, mandate } = issue({ allowedVendors: ["vnd_demo_health"] });
  const v = verifyMandate(token, { secret: SECRET, now: NOW });
  assert.ok(v.ok);
  assert.deepEqual(v.mandate, mandate);
});

test("verifyMandate rejects an expired mandate", () => {
  const { token } = issue();
  const v = verifyMandate(token, {
    secret: SECRET,
    now: new Date(LATER.getTime() + 1),
  });
  assert.deepEqual(v, { ok: false, reason: "mandate expired" });
});

test("verifyMandate rejects a tampered payload", () => {
  const { token } = issue();
  const [payload, sig] = token.split(".");
  const m = JSON.parse(Buffer.from(payload, "base64url").toString()) as Mandate;
  m.maxTotalCents = 9_999_999;
  const forged = `${Buffer.from(JSON.stringify(m)).toString("base64url")}.${sig}`;
  const v = verifyMandate(forged, { secret: SECRET, now: NOW });
  assert.deepEqual(v, { ok: false, reason: "invalid mandate signature" });
});

test("verifyMandate rejects a token signed with another secret", () => {
  const { token } = issue();
  const v = verifyMandate(token, { secret: "other", now: NOW });
  assert.equal(v.ok, false);
});

test("verifyMandate rejects malformed tokens without throwing", () => {
  for (const bad of ["", "abc", "a.b.c", ".", "###.###", "x".repeat(10_000)]) {
    const v = verifyMandate(bad, { secret: SECRET, now: NOW });
    assert.equal(v.ok, false, bad.slice(0, 10));
  }
  assert.equal(
    verifyMandate(undefined as unknown as string, { secret: SECRET }).ok,
    false,
  );
});

test("verifyMandate rejects a payload of the wrong shape", () => {
  const { token } = issue();
  const payload = Buffer.from(JSON.stringify({ hello: 1 })).toString(
    "base64url",
  );
  const v = verifyMandate(`${payload}.${token.split(".")[1]}`, {
    secret: SECRET,
    now: NOW,
  });
  assert.equal(v.ok, false);
});

test("issueMandate validates its input", () => {
  const bad: Record<string, unknown>[] = [
    { maxTotalCents: 0 },
    { maxTotalCents: 1.5 },
    { maxTotalCents: -5 },
    { maxPerOrderCents: 0 },
    { maxPerOrderCents: 20_000 }, // above the total
    { buyerId: "" },
    { expiresAt: "not a date" },
    { expiresAt: NOW.toISOString() }, // not in the future
    { allowedVendors: [] },
    { allowedTags: [""] },
  ];
  for (const b of bad)
    assert.throws(() => issue(b), /invalid mandate/, JSON.stringify(b));
});

test("checkSpend allows a purchase inside every limit", () => {
  const { mandate } = issue({
    allowedVendors: ["vnd_demo_health"],
    allowedTags: ["cardiology"],
  });
  assert.deepEqual(checkSpend(mandate, 0, 4900, DS, NOW), { allow: true });
  // exactly at the total and per-order boundaries
  assert.deepEqual(checkSpend(mandate, 4_100, 5_900, DS, NOW), { allow: true });
});

test("checkSpend denies over the per-order cap", () => {
  const { mandate } = issue();
  const r = checkSpend(mandate, 0, 6_001, DS, NOW);
  assert.equal(r.allow, false);
  assert.match(r.allow ? "" : r.reason, /per-order/);
});

test("checkSpend denies when the running total would be exceeded", () => {
  const { mandate } = issue();
  const r = checkSpend(mandate, 5_001, 5_000, DS, NOW);
  assert.equal(r.allow, false);
  assert.match(r.allow ? "" : r.reason, /remaining/);
});

test("checkSpend denies a vendor outside allowedVendors", () => {
  const { mandate } = issue({ allowedVendors: ["vnd_other"] });
  const r = checkSpend(mandate, 0, 100, DS, NOW);
  assert.equal(r.allow, false);
  assert.match(r.allow ? "" : r.reason, /vendor/);
});

test("checkSpend requires at least one allowed tag to match", () => {
  const { mandate } = issue({ allowedTags: ["oncology"] });
  const r = checkSpend(mandate, 0, 100, DS, NOW);
  assert.equal(r.allow, false);
  assert.match(r.allow ? "" : r.reason, /tag/);
});

test("checkSpend denies after expiry and for invalid amounts", () => {
  const { mandate } = issue();
  const late = new Date(LATER.getTime() + 1);
  assert.equal(checkSpend(mandate, 0, 100, DS, late).allow, false);
  assert.equal(checkSpend(mandate, 0, 0, DS, NOW).allow, false);
  assert.equal(checkSpend(mandate, 0, NaN, DS, NOW).allow, false);
  assert.equal(checkSpend(mandate, -1, 100, DS, NOW).allow, false);
});

test("a dev fallback secret is used when MANDATE_SECRET is unset", () => {
  const saved = process.env.MANDATE_SECRET;
  delete process.env.MANDATE_SECRET;
  try {
    const { token } = issueMandate({
      buyerId: "b",
      maxTotalCents: 100,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    assert.ok(verifyMandate(token).ok);
    process.env.MANDATE_SECRET = "different";
    assert.equal(verifyMandate(token).ok, false);
  } finally {
    if (saved === undefined) delete process.env.MANDATE_SECRET;
    else process.env.MANDATE_SECRET = saved;
  }
});
