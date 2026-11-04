import { test } from "node:test";
import assert from "node:assert/strict";

import { DELETE, GET, POST } from "./handlers";
import { withAgentDb } from "../../../lib/agent/test-db";
import { verifyMandate } from "../../../lib/agent/mandate";
import { checkBodySize } from "../../../lib/http/body-limit";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/mandates", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

test(
  "POST issues a verifiable mandate token",
  withAgentDb(async () => {
    const res = await post({
      buyerId: "researcher@example.com",
      maxTotalCents: 10_000,
      maxPerOrderCents: 6_000,
      allowedTags: ["cardiology"],
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mandate.maxTotalCents, 10_000);
    assert.equal(body.mandate.maxPerOrderCents, 6_000);
    assert.deepEqual(body.mandate.allowedTags, ["cardiology"]);
    const v = verifyMandate(body.token);
    assert.ok(v.ok);
    assert.equal(v.mandate.id, body.mandate.id);
  }),
);

test(
  "POST defaults buyerId, per-order cap and a one hour expiry",
  withAgentDb(async () => {
    const res = await post({ maxTotalCents: 5000 });
    assert.equal(res.status, 200);
    const { mandate } = await res.json();
    assert.equal(mandate.maxPerOrderCents, 5000);
    assert.ok(mandate.buyerId.length > 0);
    const ttl = Date.parse(mandate.expiresAt) - Date.parse(mandate.issuedAt);
    assert.equal(ttl, 3_600_000);
  }),
);

test("POST rejects bad input with 422", async () => {
  const bad: unknown[] = [
    {},
    { maxTotalCents: 0 },
    { maxTotalCents: 1.5 },
    { maxTotalCents: "100" },
    { maxTotalCents: 100, maxPerOrderCents: 200 },
    { maxTotalCents: 100, expiresAt: "2020-01-01T00:00:00.000Z" },
    { maxTotalCents: 100, expiresAt: "soon" },
    { maxTotalCents: 100, allowedVendors: [] },
    { maxTotalCents: 100, surprise: true },
    "not json",
    null,
  ];
  for (const b of bad) {
    const res = await post(b as never);
    assert.equal(res.status, 422, JSON.stringify(b));
    assert.equal(typeof (await res.json()).error, "string");
  }
});

test("the proxy body cap covers /api/mandates", () => {
  const big = new Headers({ "content-length": String(1024 * 1024) });
  assert.equal(checkBodySize("POST", "/api/mandates", big)?.status, 413);
});

test(
  "GET lists an issued mandate and DELETE revokes it",
  withAgentDb(async () => {
    const { mandate } = await (await post({ maxTotalCents: 5000 })).json();
    const listed = await (
      await GET(new Request("http://localhost/api/mandates"))
    ).json();
    assert.equal(listed.mandates[0].id, mandate.id);
    assert.equal(listed.mandates[0].status, "active");
    assert.equal(listed.mandates[0].remainingCents, 5000);
    assert.equal(JSON.stringify(listed).includes("token"), false);

    const res = await DELETE(
      new Request(`http://localhost/api/mandates?mandateId=${mandate.id}`, {
        method: "DELETE",
      }),
    );
    assert.equal(res.status, 200);
    assert.equal((await res.json()).mandate.status, "revoked");
  }),
);

test(
  "DELETE needs a mandate id and answers 404 for an unknown one",
  withAgentDb(async () => {
    const del = (q: string) =>
      DELETE(
        new Request(`http://localhost/api/mandates${q}`, { method: "DELETE" }),
      );
    assert.equal((await del("")).status, 422);
    assert.equal((await del("?mandateId=mdt_nope")).status, 404);
  }),
);
