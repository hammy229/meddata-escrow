// Request body size caps for API writes, enforced in proxy.ts from the
// Content-Length header before any route handler buffers the body.
//
// Every legitimate client here (the app's own fetch calls, curl, PayPal)
// sends Content-Length, so a write that declares a chunked body without one
// is refused (411) instead of slipping past the cap.

export const DEFAULT_MAX_BODY_BYTES = 32 * 1024;
/** PayPal webhook events embed full resource objects and can be large. */
export const WEBHOOK_MAX_BODY_BYTES = 256 * 1024;

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface BodyLimitRejection {
  status: 400 | 411 | 413;
  error: string;
}

export function maxBodyBytesFor(pathname: string): number {
  return pathname === "/api/webhooks/paypal" ||
    pathname.startsWith("/api/webhooks/paypal/")
    ? WEBHOOK_MAX_BODY_BYTES
    : DEFAULT_MAX_BODY_BYTES;
}

/** null when the request may proceed, else the error response to send. */
export function checkBodySize(
  method: string,
  pathname: string,
  headers: Headers,
): BodyLimitRejection | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null;
  const max = maxBodyBytesFor(pathname);
  const declared = headers.get("content-length");

  if (declared === null) {
    return headers.has("transfer-encoding")
      ? { status: 411, error: "Content-Length is required for request bodies." }
      : null; // no body at all
  }
  if (!/^\d+$/.test(declared.trim())) {
    return { status: 400, error: "Invalid Content-Length header." };
  }
  if (Number(declared) > max) {
    return {
      status: 413,
      error: `Request body too large (max ${max / 1024} KB).`,
    };
  }
  return null;
}
