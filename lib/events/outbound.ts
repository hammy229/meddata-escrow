// Signed outbound webhooks for escrow transitions (Zapier-ready).
//
// When OUTBOUND_WEBHOOK_URL is set, every escrow transition (and order
// creation) is POSTed there as JSON:
//
//   { type: "escrow.transition", orderId, event, from, to, amountCents,
//     datasetId, at }
//
// `event` is the state-machine event ("CREATE" for a new order, whose `from`
// is null); `at` is an ISO-8601 timestamp. Works with a Zapier "Catch Hook" or
// any webhook receiver.
//
// Signature: when OUTBOUND_WEBHOOK_SECRET is set, the request carries
//   X-MedData-Signature: sha256=<hex HMAC-SHA256 of the exact body bytes>
// Receivers should recompute it over the raw body and compare in constant
// time. Without a secret the header is omitted (fine for a Zapier demo, not
// for anything that acts on the payload).
//
// Delivery is fire-and-forget with a 3s timeout. It never throws into the
// request path: failures are logged (status only) and dropped. Unset URL =>
// no-op.
import { createHmac } from "node:crypto";

import type { EscrowState } from "../escrow/state-machine";

export interface EscrowTransitionPayload {
  type: "escrow.transition";
  orderId: string;
  /** EscrowEvent, or "CREATE" for order creation. */
  event: string;
  /** Null for creation. */
  from: EscrowState | null;
  to: EscrowState;
  amountCents: number;
  datasetId: string;
  /** ISO-8601 time the transition was emitted. */
  at: string;
}

export type EscrowTransition = Omit<EscrowTransitionPayload, "type" | "at"> & {
  at?: string;
};

export interface OutboundDeps {
  /** Defaults to process.env.OUTBOUND_WEBHOOK_URL. */
  url?: string;
  /** Defaults to process.env.OUTBOUND_WEBHOOK_SECRET. */
  secret?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export const SIGNATURE_HEADER = "X-MedData-Signature";
const DEFAULT_TIMEOUT_MS = 3000;

/** `sha256=<hex HMAC-SHA256(body, secret)>` — the X-MedData-Signature value. */
export function signOutboundBody(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * POST one transition to OUTBOUND_WEBHOOK_URL. Resolves (never rejects) once
 * delivery succeeded, failed, or timed out; callers in the request path should
 * not await it (`void emitEscrowTransition(...)`).
 */
export async function emitEscrowTransition(
  transition: EscrowTransition,
  deps: OutboundDeps = {},
): Promise<void> {
  const url = deps.url ?? process.env.OUTBOUND_WEBHOOK_URL;
  if (!url) return;
  try {
    const payload: EscrowTransitionPayload = {
      type: "escrow.transition",
      orderId: transition.orderId,
      event: transition.event,
      from: transition.from,
      to: transition.to,
      amountCents: transition.amountCents,
      datasetId: transition.datasetId,
      at: transition.at ?? new Date().toISOString(),
    };
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = deps.secret ?? process.env.OUTBOUND_WEBHOOK_SECRET;
    if (secret) headers[SIGNATURE_HEADER] = signOutboundBody(body, secret);

    const res = await (deps.fetch ?? fetch)(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`outbound webhook rejected: HTTP ${res.status}`);
  } catch (err) {
    // Timeout, DNS, refused connection... never the request path's problem.
    console.error(
      "outbound webhook failed:",
      err instanceof Error ? err.name : String(err),
    );
  }
}
