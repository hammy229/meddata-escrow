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
import { REQUEST_ID_HEADER, resolveRequestId } from "./lib/http/request-id";

// Per-instance, in-memory — see lib/http/rate-limit.ts.
const limiter = createRateLimiter();

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headers: Record<string, string> = { [REQUEST_ID_HEADER]: requestId };

  const tooBig = checkBodySize(request.method, pathname, request.headers);
  if (tooBig) {
    return NextResponse.json(
      { error: tooBig.error },
      { status: tooBig.status, headers },
    );
  }

  const rule = rateLimitRuleFor(request.method, pathname);
  if (rule) {
    const result = limiter.check(
      `${pathname}|${clientIp(request.headers)}`,
      rule,
    );
    Object.assign(headers, rateLimitHeaders(result));
    if (!result.allowed) {
      return NextResponse.json(
        { error: "Too many requests — slow down and retry shortly." },
        { status: 429, headers },
      );
    }
  }

  // Forward the id to the route handler too, so its logs can include it.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  return response;
}

export const config = {
  matcher: "/api/:path*",
};
