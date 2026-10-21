// Security headers spec — the CSP stays strict in production and every
// required header is present.
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCsp, securityHeaders } from "./security-headers";

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp.split("; ").map((d) => {
      const [name, ...sources] = d.split(" ");
      return [name, sources];
    }),
  );
}

test("production CSP never allows eval and blocks framing and plugins", () => {
  const csp = directives(buildCsp(false));
  assert.equal(csp.get("script-src")?.includes("'unsafe-eval'"), false);
  assert.deepEqual(csp.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(csp.get("object-src"), ["'none'"]);
  assert.deepEqual(csp.get("default-src"), ["'self'"]);
  assert.deepEqual(csp.get("base-uri"), ["'self'"]);
});

test("development CSP adds unsafe-eval for React dev tooling only", () => {
  const csp = directives(buildCsp(true));
  assert.ok(csp.get("script-src")?.includes("'unsafe-eval'"));
});

test("fonts are self-hosted: no Google font origins in the CSP", () => {
  const csp = buildCsp(false);
  assert.doesNotMatch(csp, /fonts\.(googleapis|gstatic)\.com/);
  assert.deepEqual(directives(csp).get("font-src"), ["'self'"]);
});

test("securityHeaders returns the full required set", () => {
  const headers = new Map(
    securityHeaders(false).map((h) => [h.key, h.value] as const),
  );
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("X-Frame-Options"), "DENY");
  assert.equal(
    headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
  assert.match(headers.get("Strict-Transport-Security") ?? "", /max-age=\d+/);
  const pp = headers.get("Permissions-Policy") ?? "";
  for (const feature of ["camera=()", "microphone=()", "geolocation=()"]) {
    assert.ok(pp.includes(feature), feature);
  }
  assert.ok(headers.has("Content-Security-Policy"));
});
