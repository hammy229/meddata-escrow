import { test } from "node:test";
import assert from "node:assert/strict";

import { mockDeliveryUrl, presignDelivery } from "./mock-s3";

test("presignDelivery expires after ttlSeconds (default 900) and is marked mock", () => {
  const before = Date.now();
  const d = presignDelivery("ds_a", { orderId: "ord_1" });
  const after = Date.now();
  assert.equal(d.mock, true);
  const exp = Date.parse(d.expiresAt);
  assert.ok(exp >= before + 900_000 && exp <= after + 900_000);
  const url = new URL(d.url);
  assert.ok(url.pathname.includes("ds_a"));
  assert.equal(url.searchParams.get("orderId"), "ord_1");
  assert.equal(Number(url.searchParams.get("expires")), Math.floor(exp / 1000));
});

test("presignDelivery honours a custom ttl and mints a fresh signature each time", () => {
  const a = presignDelivery("ds_a", { orderId: "o", ttlSeconds: 60 });
  const b = presignDelivery("ds_a", { orderId: "o", ttlSeconds: 60 });
  assert.ok(Date.parse(a.expiresAt) - Date.now() <= 60_000);
  assert.notEqual(a.url, b.url);
});

test("returns an https url embedding the dataset id and a future expiry", () => {
  const before = Math.floor(Date.now() / 1000);
  const url = mockDeliveryUrl("ds_cardio_synthea_v1", {
    expiresInSeconds: 600,
  });
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "https:");
  assert.ok(parsed.pathname.includes("ds_cardio_synthea_v1"));
  const expires = Number(parsed.searchParams.get("expires"));
  assert.ok(expires >= before + 600, "expiry should be ~600s in the future");
  assert.ok(
    parsed.searchParams.get("signature"),
    "should carry a (fake) signature",
  );
});
