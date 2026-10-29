// Classifies a call to /api/orders for the researcher page. A response from the
// server, success or failure, is real and shown as is. Only a request that
// never got a response (fetch throws) counts as offline, the one case where the
// page keeps its clearly labelled demo fallback.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EscrowBody = Record<string, any>;

export type EscrowOutcome =
  | { kind: "ok"; status: number; data: EscrowBody }
  | { kind: "error"; status: number; message: string }
  | { kind: "offline" };

/**
 * Send a request and sort the result. Pass `fetchFn` to swap the transport
 * (tests do); it defaults to the global fetch.
 */
export async function escrowRequest(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch = fetch,
): Promise<EscrowOutcome> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    return { kind: "offline" };
  }
  const parsed: unknown = await res.json().catch(() => null);
  const data: EscrowBody =
    parsed && typeof parsed === "object" ? (parsed as EscrowBody) : {};
  if (res.ok) return { kind: "ok", status: res.status, data };
  const message =
    typeof data.error === "string" && data.error.trim() !== ""
      ? data.error
      : `The escrow service responded ${res.status}.`;
  return { kind: "error", status: res.status, message };
}
