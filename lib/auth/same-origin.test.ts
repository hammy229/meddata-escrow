import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "./access";

function post(url: string, headers: Record<string, string>): Request {
  return new Request(url, { method: "POST", headers });
}

test("sameOrigin accepts a same-origin browser request", () => {
  assert.equal(
    sameOrigin(
      post("http://localhost:3000/api/x", { origin: "http://localhost:3000" }),
    ),
    true,
  );
});

test("sameOrigin accepts a request with no Origin header", () => {
  assert.equal(sameOrigin(post("http://localhost:3000/api/x", {})), true);
});

test("sameOrigin accepts HTTPS behind a proxy that forwards plain HTTP", () => {
  // Render and similar hosts end TLS at the proxy, so the app sees http://.
  const req = post("http://meddata-escrow.onrender.com/api/x", {
    origin: "https://meddata-escrow.onrender.com",
    host: "meddata-escrow.onrender.com",
    "x-forwarded-proto": "https",
  });
  assert.equal(sameOrigin(req), true);
});

test("sameOrigin trusts the forwarded host when the app sees an internal one", () => {
  const req = post("http://localhost:10000/api/x", {
    origin: "https://meddata-escrow.onrender.com",
    "x-forwarded-host": "meddata-escrow.onrender.com",
    "x-forwarded-proto": "https",
  });
  assert.equal(sameOrigin(req), true);
});

test("sameOrigin rejects another site's Origin", () => {
  const req = post("http://meddata-escrow.onrender.com/api/x", {
    origin: "https://evil.example",
    host: "meddata-escrow.onrender.com",
    "x-forwarded-proto": "https",
  });
  assert.equal(sameOrigin(req), false);
});

test("sameOrigin rejects a look-alike host", () => {
  const req = post("http://meddata-escrow.onrender.com/api/x", {
    origin: "https://meddata-escrow.onrender.com.evil.example",
  });
  assert.equal(sameOrigin(req), false);
});

test("sameOrigin rejects a cross-site fetch even without Origin", () => {
  const req = post("http://localhost:3000/api/x", {
    "sec-fetch-site": "cross-site",
  });
  assert.equal(sameOrigin(req), false);
});

test("sameOrigin rejects an unparseable Origin", () => {
  const req = post("http://localhost:3000/api/x", { origin: "null" });
  assert.equal(sameOrigin(req), false);
});
