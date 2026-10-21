// Rate limiter spec — sliding window semantics with an injected clock, route
// selection, and client IP extraction.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  clientIp,
  createRateLimiter,
  rateLimitHeaders,
  rateLimitRuleFor,
} from "./rate-limit";

const RULE = { limit: 3, windowMs: 60_000 };

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("allows up to the limit, then blocks with a retry hint", () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  const results = [1, 2, 3].map(() => rl.check("ip", RULE));
  assert.deepEqual(
    results.map((r) => [r.allowed, r.remaining]),
    [
      [true, 2],
      [true, 1],
      [true, 0],
    ],
  );
  c.advance(10_000);
  const blocked = rl.check("ip", RULE);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.resetSeconds, 50); // oldest hit leaves at t0 + 60s
});

test("window slides: a slot frees exactly when the oldest hit expires", () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  rl.check("ip", RULE);
  c.advance(20_000);
  rl.check("ip", RULE);
  rl.check("ip", RULE);
  c.advance(39_999);
  assert.equal(rl.check("ip", RULE).allowed, false);
  c.advance(1); // first hit is now 60s old
  assert.equal(rl.check("ip", RULE).allowed, true);
  assert.equal(rl.check("ip", RULE).allowed, false);
});

test("blocked attempts do not extend the lockout", () => {
  const c = clock();
  const rl = createRateLimiter({ now: c.now });
  for (let i = 0; i < 3; i++) rl.check("ip", RULE);
  for (let i = 0; i < 50; i++) rl.check("ip", RULE);
  c.advance(60_000);
  assert.equal(rl.check("ip", RULE).allowed, true);
});

test("keys are independent", () => {
  const rl = createRateLimiter({ now: clock().now });
  for (let i = 0; i < 3; i++) rl.check("a", RULE);
  assert.equal(rl.check("a", RULE).allowed, false);
  assert.equal(rl.check("b", RULE).allowed, true);
});

test("tracked keys are capped", () => {
  const rl = createRateLimiter({ now: clock().now, maxKeys: 2 });
  rl.check("a", RULE);
  rl.check("b", RULE);
  rl.check("c", RULE);
  assert.equal(rl.size(), 2);
});

test("rateLimitRuleFor covers the expensive POST routes only", () => {
  assert.equal(rateLimitRuleFor("POST", "/api/query")?.limit, 30);
  assert.equal(rateLimitRuleFor("POST", "/api/match")?.limit, 20);
  assert.equal(rateLimitRuleFor("POST", "/api/agent")?.limit, 5);
  assert.ok(rateLimitRuleFor("post", "/api/orders/"));
  assert.equal(rateLimitRuleFor("GET", "/api/orders"), null);
  assert.equal(rateLimitRuleFor("PATCH", "/api/orders"), null);
  assert.equal(rateLimitRuleFor("POST", "/api/webhooks/paypal"), null);
  assert.equal(rateLimitRuleFor("GET", "/api/health"), null);
  assert.equal(rateLimitRuleFor("POST", "/api/health"), null);
});

test("clientIp takes the first X-Forwarded-For hop, then X-Real-IP", () => {
  assert.equal(
    clientIp(new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1" })),
    "203.0.113.7",
  );
  assert.equal(
    clientIp(new Headers({ "x-real-ip": "198.51.100.2" })),
    "198.51.100.2",
  );
  assert.equal(clientIp(new Headers()), "unknown");
});

test("rateLimitHeaders adds Retry-After only when blocked", () => {
  const ok = rateLimitHeaders({
    allowed: true,
    limit: 5,
    remaining: 4,
    resetSeconds: 60,
  });
  assert.equal(ok["RateLimit-Remaining"], "4");
  assert.equal(ok["Retry-After"], undefined);
  const blocked = rateLimitHeaders({
    allowed: false,
    limit: 5,
    remaining: 0,
    resetSeconds: 12,
  });
  assert.equal(blocked["Retry-After"], "12");
  assert.equal(blocked["RateLimit-Reset"], "12");
});
