// In-memory sliding-window rate limiter for the expensive API routes
// (Claude-backed matching/querying and order writes), applied in proxy.ts.
//
// Per-instance by design: counters live in this process's memory, so they
// reset on restart and are not shared between instances. That is fine for the
// single Render instance this app runs on; behind several instances, swap the
// store for Redis (e.g. a sorted set per key) and keep the same interface.

export interface RateLimitRule {
  /** Max requests allowed inside one window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until a slot frees up (the oldest counted hit leaves the window). */
  resetSeconds: number;
}

const MINUTE = 60_000;

/** Rate-limited POST routes. Anything not listed (notably /api/webhooks/paypal
 * and /api/health) is never limited. */
export const RATE_LIMITS: Readonly<Record<string, RateLimitRule>> = {
  "/api/query": { limit: 30, windowMs: MINUTE },
  "/api/match": { limit: 20, windowMs: MINUTE },
  "/api/agent": { limit: 5, windowMs: MINUTE },
  // One researcher purchase is ~5 order POSTs (create, authorize, capture...).
  "/api/orders": { limit: 60, windowMs: MINUTE },
};

export function rateLimitRuleFor(
  method: string,
  pathname: string,
): RateLimitRule | null {
  if (method.toUpperCase() !== "POST") return null;
  const path =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return RATE_LIMITS[path] ?? null;
}

/** Client IP: first hop of X-Forwarded-For (set by Render's proxy), then
 * X-Real-IP, else a shared "unknown" bucket. */
export function clientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (first) return first;
  const real = headers.get("x-real-ip")?.trim();
  return real || "unknown";
}

export interface RateLimiterOptions {
  /** Injectable clock (ms) for tests. */
  now?: () => number;
  /** Hard cap on tracked keys so a flood of spoofed IPs cannot grow memory
   * without bound; the oldest-inserted key is evicted past it. */
  maxKeys?: number;
}

export interface RateLimiter {
  check(key: string, rule: RateLimitRule): RateLimitResult;
  /** Number of keys currently tracked (for tests). */
  size(): number;
}

export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const now = opts.now ?? Date.now;
  const maxKeys = opts.maxKeys ?? 10_000;
  // key -> ascending hit timestamps still inside the window
  const hits = new Map<string, number[]>();

  return {
    check(key, rule) {
      const t = now();
      const windowStart = t - rule.windowMs;
      const log = (hits.get(key) ?? []).filter((ts) => ts > windowStart);

      let allowed = false;
      if (log.length < rule.limit) {
        log.push(t);
        allowed = true;
      }
      // Re-insert so Map order tracks recency for eviction.
      hits.delete(key);
      hits.set(key, log);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value as string;
        hits.delete(oldest);
      }

      const resetMs = log.length > 0 ? log[0] + rule.windowMs - t : 0;
      return {
        allowed,
        limit: rule.limit,
        remaining: Math.max(0, rule.limit - log.length),
        resetSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
      };
    },
    size: () => hits.size,
  };
}

/** RateLimit-* (IETF draft) headers, plus Retry-After when blocked. */
export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(r.resetSeconds),
  };
  if (!r.allowed) headers["Retry-After"] = String(r.resetSeconds);
  return headers;
}
