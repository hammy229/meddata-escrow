// X-Request-Id for every API response, so a log line and a bug report can be
// matched up. An incoming id (e.g. from a load balancer or a client retry) is
// reused only if it is a plain token, so it cannot inject into logs/headers.

export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_TOKEN = /^[A-Za-z0-9._:-]{8,128}$/;

export function isSafeRequestId(value: string): boolean {
  return SAFE_TOKEN.test(value);
}

export function resolveRequestId(
  incoming: string | null | undefined,
  generate: () => string = () => crypto.randomUUID(),
): string {
  const candidate = incoming?.trim();
  return candidate && isSafeRequestId(candidate) ? candidate : generate();
}
