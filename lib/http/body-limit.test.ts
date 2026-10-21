// Body size cap spec — writes over the limit get 413, the PayPal webhook gets
// a larger allowance, and reads are untouched.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkBodySize,
  DEFAULT_MAX_BODY_BYTES,
  maxBodyBytesFor,
  WEBHOOK_MAX_BODY_BYTES,
} from "./body-limit";

const len = (n: number | string) =>
  new Headers({ "content-length": String(n) });

test("API writes up to 32 KB pass; one byte more is 413", () => {
  for (const method of ["POST", "PATCH", "put", "DELETE"]) {
    assert.equal(
      checkBodySize(method, "/api/orders", len(DEFAULT_MAX_BODY_BYTES)),
      null,
    );
    assert.equal(
      checkBodySize(method, "/api/orders", len(DEFAULT_MAX_BODY_BYTES + 1))
        ?.status,
      413,
    );
  }
});

test("the PayPal webhook allows up to 256 KB", () => {
  assert.equal(maxBodyBytesFor("/api/webhooks/paypal"), WEBHOOK_MAX_BODY_BYTES);
  assert.equal(
    checkBodySize("POST", "/api/webhooks/paypal", len(200 * 1024)),
    null,
  );
  assert.equal(
    checkBodySize(
      "POST",
      "/api/webhooks/paypal",
      len(WEBHOOK_MAX_BODY_BYTES + 1),
    )?.status,
    413,
  );
  // The larger allowance does not leak to look-alike paths.
  assert.equal(
    maxBodyBytesFor("/api/webhooks/paypalx"),
    DEFAULT_MAX_BODY_BYTES,
  );
});

test("reads are never checked", () => {
  assert.equal(checkBodySize("GET", "/api/orders", len(10_000_000)), null);
  assert.equal(checkBodySize("HEAD", "/api/orders", len(10_000_000)), null);
});

test("bodyless writes pass; chunked writes without a length get 411", () => {
  assert.equal(checkBodySize("POST", "/api/orders", new Headers()), null);
  assert.equal(
    checkBodySize(
      "POST",
      "/api/orders",
      new Headers({ "transfer-encoding": "chunked" }),
    )?.status,
    411,
  );
});

test("a malformed Content-Length is a 400", () => {
  for (const bad of ["-1", "12abc", "1e9", ""]) {
    assert.equal(checkBodySize("POST", "/api/orders", len(bad))?.status, 400);
  }
});
