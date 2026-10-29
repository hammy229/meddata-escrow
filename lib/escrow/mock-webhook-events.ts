// Realistic PayPal webhook payloads for the mock-mode simulator. Each builder
// returns the JSON PayPal would POST for an order we already hold, with the ids
// lib/escrow/paypal-webhooks matches on (authorization id, PayPal order id).
// Pure and framework-free, so the vendor UI and the tests share it.

export type MockWebhookKind =
  "capture_completed" | "authorization_voided" | "dispute_created";

/** The order fields a payload refers to (raw OrderRow columns). */
export interface MockWebhookOrder {
  id: string;
  paypal_order_id: string | null;
  authorization_id: string | null;
  amount_cents: number;
}

export const MOCK_WEBHOOK_KINDS: {
  kind: MockWebhookKind;
  label: string;
  eventType: string;
}[] = [
  {
    kind: "capture_completed",
    label: "Capture completed",
    eventType: "PAYMENT.CAPTURE.COMPLETED",
  },
  {
    kind: "authorization_voided",
    label: "Authorization voided",
    eventType: "PAYMENT.AUTHORIZATION.VOIDED",
  },
  {
    kind: "dispute_created",
    label: "Dispute created",
    eventType: "CUSTOMER.DISPUTE.CREATED",
  },
];

function randomId(): string {
  const c = globalThis.crypto;
  return typeof c?.randomUUID === "function"
    ? c.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function money(cents: number) {
  return { currency_code: "USD", value: (cents / 100).toFixed(2) };
}

/**
 * Build the webhook event for `kind` against `order`. `eventId` (unique per
 * delivery; a repeat is treated as a replay) and `now` are injectable for tests.
 */
export function buildMockWebhookEvent(
  kind: MockWebhookKind,
  order: MockWebhookOrder,
  opts: { eventId?: string; now?: Date } = {},
): Record<string, unknown> {
  const suffix = randomId().slice(0, 8).toUpperCase();
  const eventId = opts.eventId ?? `WH-MOCK-${randomId()}`;
  const createTime = (opts.now ?? new Date()).toISOString();
  const authId = order.authorization_id ?? undefined;
  const base = { id: eventId, create_time: createTime, event_version: "1.0" };
  const links = (path: string) => [
    {
      href: `https://api.sandbox.paypal.com/v2/${path}`,
      rel: "self",
      method: "GET",
    },
  ];

  switch (kind) {
    case "capture_completed":
      return {
        ...base,
        resource_type: "capture",
        event_type: "PAYMENT.CAPTURE.COMPLETED",
        summary: "Payment completed",
        resource: {
          id: `MOCK-CAP-${suffix}`,
          status: "COMPLETED",
          amount: money(order.amount_cents),
          final_capture: true,
          create_time: createTime,
          supplementary_data: {
            related_ids: {
              ...(authId && { authorization_id: authId }),
              ...(order.paypal_order_id && {
                order_id: order.paypal_order_id,
              }),
            },
          },
          links: links(`payments/captures/MOCK-CAP-${suffix}`),
        },
      };
    case "authorization_voided":
      return {
        ...base,
        resource_type: "authorization",
        event_type: "PAYMENT.AUTHORIZATION.VOIDED",
        summary: "A payment authorization was voided",
        resource: {
          id: authId ?? `MOCK-AUTH-${suffix}`,
          status: "VOIDED",
          amount: money(order.amount_cents),
          create_time: createTime,
          supplementary_data: {
            related_ids: {
              ...(order.paypal_order_id && {
                order_id: order.paypal_order_id,
              }),
            },
          },
          links: links(`payments/authorizations/${authId ?? suffix}`),
        },
      };
    case "dispute_created":
      return {
        ...base,
        resource_type: "dispute",
        event_type: "CUSTOMER.DISPUTE.CREATED",
        summary: "A new dispute opened",
        resource: {
          dispute_id: `PP-D-MOCK-${suffix}`,
          id: `PP-D-MOCK-${suffix}`,
          reason: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
          status: "OPEN",
          dispute_amount: money(order.amount_cents),
          create_time: createTime,
          disputed_transactions: [
            {
              seller_transaction_id: authId ?? order.paypal_order_id ?? suffix,
              seller: { name: "Mock vendor" },
            },
          ],
        },
      };
  }
}
