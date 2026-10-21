// Apply a VERIFIED PayPal webhook event to escrow state (framework-free).
//
// PayPal is the source of truth for money movement; webhooks tell us about
// moves that happened outside our request path (a capture that completed after
// a timeout, a void, a dispute opened by the buyer). Rules:
//
//   - Idempotent: every event id is recorded in paypal_webhook_events in the
//     SAME transaction as any state change, so a replay is a no-op.
//   - Conservative: an event is applied ONLY when its state-machine event is
//     legal from the order's current state. Anything else (already there,
//     out-of-order, unknown order) is recorded and ignored, never forced.
//   - Audited: an applied transition carries the note
//     "via PayPal webhook <event_type>" on its order_events row.
//
// Signature verification is the caller's job (see verifyPayPalWebhook in
// lib/paypal/client); never pass an unverified event here.
import type { DatabaseSync } from "node:sqlite";

import {
  withDb,
  advanceOrder,
  findOrderByPayPalRef,
  recordWebhookEvent,
  type OrderPatch,
  type OrderRow,
} from "../db/client";
import { can, type EscrowEvent, type EscrowState } from "./state-machine";

/** The subset of a PayPal webhook payload we read. */
interface PayPalWebhookEvent {
  id?: unknown;
  event_type?: unknown;
  resource?: Record<string, unknown>;
}

/** What processing an event did. */
export type WebhookOutcome =
  | { kind: "duplicate"; eventId: string }
  | { kind: "ignored"; reason: string; eventId?: string; orderId?: string }
  | { kind: "recorded"; eventId: string; orderId: string; state: EscrowState }
  | {
      kind: "applied";
      eventId: string;
      order: OrderRow;
      event: EscrowEvent;
      from: EscrowState;
      to: EscrowState;
    };

/** How one PayPal event type maps onto an order. */
interface EventMapping {
  /** PayPal ids in the resource that may identify our order. */
  refs(resource: Record<string, unknown>): Array<string | undefined>;
  /**
   * The escrow event to apply from `state`, or null to record only. Only
   * returned events that are legal from `state` are applied.
   */
  decide?(
    state: EscrowState,
    resource: Record<string, unknown>,
  ): { event: EscrowEvent; patch?: OrderPatch } | null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function relatedIds(r: Record<string, unknown>): Record<string, unknown> {
  const supp = r.supplementary_data as Record<string, unknown> | undefined;
  return (supp?.related_ids as Record<string, unknown> | undefined) ?? {};
}

/** Authorization / capture resources: resource.id + related ids. */
const paymentRefs = (r: Record<string, unknown>) => [
  str(r.id),
  str(relatedIds(r).authorization_id),
  str(relatedIds(r).order_id),
];

/** Dispute resources: the disputed transactions' ids. */
const disputeRefs = (r: Record<string, unknown>) => {
  const txs = Array.isArray(r.disputed_transactions)
    ? (r.disputed_transactions as Record<string, unknown>[])
    : [];
  return [
    str(r.id),
    ...txs.flatMap((t) => [
      str(t.seller_transaction_id),
      str(t.buyer_transaction_id),
    ]),
  ];
};

const payoutRefs = (r: Record<string, unknown>) => {
  const header = r.batch_header as Record<string, unknown> | undefined;
  return [str(header?.payout_batch_id), str(r.payout_batch_id)];
};

const MAPPINGS: Record<string, EventMapping> = {
  "PAYMENT.AUTHORIZATION.CREATED": {
    refs: paymentRefs,
    decide: (state, r) =>
      state === "MATCHED"
        ? { event: "AUTHORIZE", patch: { authorizationId: str(r.id) ?? null } }
        : null,
  },
  "PAYMENT.AUTHORIZATION.VOIDED": {
    refs: paymentRefs,
    decide: (state) =>
      state === "DISPUTED" ? { event: "RESOLVE_VOID" } : { event: "VOID" },
  },
  "PAYMENT.CAPTURE.COMPLETED": {
    refs: paymentRefs,
    decide: (state) =>
      state === "DISPUTED"
        ? { event: "RESOLVE_CAPTURE" }
        : { event: "CAPTURE" },
  },
  // No escrow state models these; record them for the audit/ops trail.
  "PAYMENT.CAPTURE.DENIED": { refs: paymentRefs },
  "PAYMENT.CAPTURE.REFUNDED": { refs: paymentRefs },
  "CUSTOMER.DISPUTE.CREATED": {
    refs: disputeRefs,
    decide: () => ({ event: "DISPUTE" }),
  },
  // Resolution moves money; in our flow that is a deliberate resolve action
  // through the escrow service, so the webhook is recorded, not applied.
  "CUSTOMER.DISPUTE.RESOLVED": { refs: disputeRefs },
  "PAYMENT.PAYOUTSBATCH.SUCCESS": { refs: payoutRefs },
  "PAYMENT.PAYOUTSBATCH.DENIED": { refs: payoutRefs },
};

/** Event types that need a human to look at them even though no state moves. */
const ALERT_TYPES = new Set([
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.REFUNDED",
  "PAYMENT.PAYOUTSBATCH.DENIED",
]);

/** Run `fn` inside a write transaction (rolls back on throw). */
function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Apply one verified event using an open DB (exported for tests/reuse). */
export function applyPayPalWebhookEvent(
  db: DatabaseSync,
  payload: unknown,
): WebhookOutcome {
  const evt = (payload ?? {}) as PayPalWebhookEvent;
  const eventId = str(evt.id);
  const eventType = str(evt.event_type);
  if (!eventId || !eventType) {
    console.warn("paypal webhook: event without id/event_type ignored");
    return { kind: "ignored", reason: "missing event id or event_type" };
  }
  const resource =
    evt.resource && typeof evt.resource === "object" ? evt.resource : {};
  const resourceId = str(resource.id) ?? null;
  const mapping = MAPPINGS[eventType];

  return inTransaction(db, () => {
    const order = mapping
      ? findOrderByPayPalRef(db, mapping.refs(resource))
      : undefined;
    const isNew = recordWebhookEvent(db, {
      id: eventId,
      eventType,
      resourceId,
      orderId: order?.id ?? null,
    });
    if (!isNew) return { kind: "duplicate", eventId } as const;

    if (!mapping)
      return {
        kind: "ignored",
        eventId,
        reason: `unhandled event type ${eventType}`,
      } as const;
    if (!order) {
      console.warn(
        `paypal webhook ${eventId} (${eventType}): no order matches resource ${resourceId ?? "?"}`,
      );
      return { kind: "ignored", eventId, reason: "no matching order" } as const;
    }
    if (ALERT_TYPES.has(eventType))
      console.warn(
        `paypal webhook ${eventId}: ${eventType} for order ${order.id} (state ${order.status}) needs review`,
      );

    const decision = mapping.decide?.(order.status, resource) ?? null;
    if (!decision)
      return {
        kind: "recorded",
        eventId,
        orderId: order.id,
        state: order.status,
      } as const;
    if (!can(order.status, decision.event)) {
      // Already there (e.g. CAPTURE.COMPLETED on a CAPTURED order) or out of
      // order. Never forced — log so a real mismatch can be investigated.
      console.warn(
        `paypal webhook ${eventId}: ${eventType} -> ${decision.event} not applicable from ${order.status} (order ${order.id})`,
      );
      return {
        kind: "ignored",
        eventId,
        orderId: order.id,
        reason: `${decision.event} not applicable from ${order.status}`,
      } as const;
    }
    const updated = advanceOrder(
      db,
      order.id,
      decision.event,
      decision.patch,
      `via PayPal webhook ${eventType}`,
    );
    return {
      kind: "applied",
      eventId,
      order: updated,
      event: decision.event,
      from: order.status,
      to: updated.status,
    } as const;
  });
}

/** Apply one verified event against the default DB (DATABASE_URL). */
export function processPayPalWebhookEvent(payload: unknown): WebhookOutcome {
  return withDb((db) => applyPayPalWebhookEvent(db, payload));
}
