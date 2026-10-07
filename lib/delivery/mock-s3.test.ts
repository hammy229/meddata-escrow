import { test } from "node:test";
import assert from "node:assert/strict";

import { mockDeliveryUrl } from "./mock-s3";

test("returns an https url embedding the dataset id and a future expiry", () => {
  const before = Math.floor(Date.now() / 1000);
  const url = mockDeliveryUrl("ds_cardio_synthea_v1", { expiresInSeconds: 600 });
  const parsed = new URL(url);

  assert.equal(parsed.protocol, "https:");
  assert.ok(parsed.pathname.includes("ds_cardio_synthea_v1"));
  const expires = Number(parsed.searchParams.get("expires"));
  assert.ok(expires >= before + 600, "expiry should be ~600s in the future");
  assert.ok(parsed.searchParams.get("signature"), "should carry a (fake) signature");
});
