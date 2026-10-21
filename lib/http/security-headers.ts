// Security headers sent on every response (wired in next.config.ts headers()).
//
// CSP notes:
// - Scripts/styles use 'unsafe-inline' rather than nonces. Every page here is
//   statically prerendered, and Next.js can only inject a nonce while
//   rendering per request — nonces would force dynamic rendering on every
//   page (losing the static HTML/CDN path) for a site that renders no
//   user-controlled HTML. Next's own bootstrap (`self.__next_f.push(...)`)
//   and next/font's preload/style tags are inline, so they need it. Upgrade
//   path: the proxy nonce recipe in the Next CSP guide, or experimental SRI.
// - 'unsafe-eval' only in development (React dev tooling uses eval for error
//   stacks; production React/Next do not).
// - Fonts are self-hosted by next/font/google at build time and served from
//   /_next/static/media, so font-src is 'self' — no Google origins at runtime.
// - The landing page renders tool logos from cdn.simpleicons.org; that is the
//   only third-party origin. No PayPal JS SDK is loaded in the browser (all
//   PayPal calls are server-side), so no PayPal origins are allowed.

export interface SecurityHeader {
  key: string;
  value: string;
}

export function buildCsp(isDev: boolean): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:", "https://cdn.simpleicons.org"],
    "font-src": ["'self'"],
    "connect-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(" ")}`)
    .join("; ");
}

export function securityHeaders(isDev: boolean): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: buildCsp(isDev) },
    // Two years; no `preload` — that commits the whole registrable domain.
    // Browsers ignore HSTS over plain http, so localhost is unaffected.
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains",
    },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    // Legacy twin of frame-ancestors 'none' for older browsers.
    { key: "X-Frame-Options", value: "DENY" },
  ];
}
