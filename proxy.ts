// Request interceptor for /api/* (Next 16 "proxy", formerly middleware).
// Kept thin: all decisions live in pure, tested helpers under lib/http/.
import { NextResponse, type NextRequest } from "next/server";

import { checkBodySize } from "./lib/http/body-limit";
import {
  clientIp,
  createRateLimiter,
  rateLimitHeaders,
  rateLimitRuleFor,
} from "./lib/http/rate-limit";

// Per-instance, in-memory — see lib/http/rate-limit.ts.
const limiter = createRateLimiter();

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const tooBig = checkBodySize(request.method, pathname, request.headers);
  if (tooBig) {
    return NextResponse.json(
      { error: tooBig.error },
      { status: tooBig.status },
    );
  }

  const rule = rateLimitRuleFor(request.method, pathname);
  if (rule) {
    const result = limiter.check(
      `${pathname}|${clientIp(request.headers)}`,
      rule,
    );
    const headers = rateLimitHeaders(result);
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Too many requests — slow down and retry shortly." },
        { status: 429, headers },
      );
    }
    const response = NextResponse.next();
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
