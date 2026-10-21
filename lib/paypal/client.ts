// PayPal Orders v2 / Payments client for the escrow flow (sandbox or live).
//
// Flow: createAuthorizeOrder (intent=AUTHORIZE) -> buyer approves -> authorizeOrder
// -> captureAuthorization (on delivery) | voidAuthorization (on failure) |
// reauthorizeAuthorization (past PayPal's 3-day honor period). After capture,
// createPayout releases the vendor's share via the Payouts API.
//
// Security: credentials come only from the injected config (sourced from env
// in payPalClientFromEnv). The client secret and access token are never logged
// or included in thrown errors. All traffic is HTTPS to PAYPAL_API_BASE.
//
// Idempotency: every mutating call sends a PayPal-Request-Id. Callers should
// pass a key derived from their own order + action (the escrow service sends
// `${orderId}:${action}`); when omitted, the key is derived deterministically
// from the PayPal resource id + operation (e.g. `${authorizationId}:capture`),
// so a retried capture replays PayPal's original result instead of charging
// twice. Order creation has no resource id yet, so its fallback is random.
import { randomUUID } from "node:crypto";

import { isMockMode } from "../mock/ids";

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Webhook id from the PayPal dashboard; required to verify webhooks. */
  webhookId?: string;
}

/** Anything header-shaped: a fetch Headers or a plain (lower-case) record. */
export type HeaderSource = Headers | Record<string, string | undefined>;

function readHeader(h: HeaderSource, name: string): string | undefined {
  if (h instanceof Headers) return h.get(name) ?? undefined;
  return h[name] ?? h[name.toLowerCase()];
}

/** The PayPal transmission headers verify-webhook-signature needs. */
const WEBHOOK_SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export interface CreateOrderResult {
  orderId: string;
  status: string;
  approveUrl?: string;
}
export interface AuthorizeResult {
  orderId: string;
  authorizationId: string;
  status: string;
}
export interface CaptureResult {
  captureId: string;
  status: string;
}
export interface PayoutResult {
  payoutBatchId: string;
  /** e.g. PENDING, PROCESSING, SUCCESS, DENIED. */
  batchStatus: string;
}

/** Non-2xx PayPal response. Carries the HTTP status; body is PayPal's error
 *  payload (never our credentials), safe to surface for debugging. */
export class PayPalError extends Error {
  constructor(
    readonly endpoint: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(`PayPal ${endpoint} failed: HTTP ${status}`);
    this.name = "PayPalError";
  }
}

const DEFAULT_BASE = "https://api-m.sandbox.paypal.com";

/** Format a numeric amount as a PayPal money string, e.g. 42.5 -> "42.50". */
function money(amount: number): string {
  return amount.toFixed(2);
}

export function createPayPalClient(config: PayPalConfig) {
  const base = (config.apiBase ?? DEFAULT_BASE).replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    // Refresh a minute before expiry to avoid edge-of-window failures.
    if (token && token.expiresAt > Date.now() + 60_000) return token.value;
    const basic = Buffer.from(
      `${config.clientId}:${config.clientSecret}`,
    ).toString("base64");
    const res = await doFetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok)
      throw new PayPalError("oauth2/token", res.status, await res.text());
    const json = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    token = {
      value: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return token.value;
  }

  async function call<T>(
    endpoint: string,
    path: string,
    // Every call here is a mutating POST, so the idempotency key is required.
    // Mutating calls must pass a key; `null` is only for read-like POSTs
    // (webhook signature verification).
    init: { body?: unknown; requestId: string | null },
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
    };
    // PayPal-Request-Id makes mutating calls safe to retry (idempotency).
    if (init.requestId) headers["PayPal-Request-Id"] = init.requestId;
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (!res.ok) throw new PayPalError(endpoint, res.status, await res.text());
    // 204 No Content (e.g. void) has no body to parse.
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async createAuthorizeOrder(input: {
      amount: number;
      currency?: string;
      referenceId?: string;
      /** Idempotency key; random when omitted (no resource id exists yet). */
      requestId?: string;
    }): Promise<CreateOrderResult> {
      const body = {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            ...(input.referenceId ? { reference_id: input.referenceId } : {}),
            amount: {
              currency_code: input.currency ?? "USD",
              value: money(input.amount),
            },
          },
        ],
      };
      const json = await call<{
        id: string;
        status: string;
        links?: Array<{ rel: string; href: string }>;
      }>("orders.create", "/v2/checkout/orders", {
        body,
        requestId: input.requestId ?? `create:${randomUUID()}`,
      });
      return {
        orderId: json.id,
        status: json.status,
        approveUrl: json.links?.find(
          (l) => l.rel === "approve" || l.rel === "payer-action",
        )?.href,
      };
    },

    async authorizeOrder(
      orderId: string,
      opts: { requestId?: string } = {},
    ): Promise<AuthorizeResult> {
      const json = await call<{
        id: string;
        purchase_units?: Array<{
          payments?: { authorizations?: Array<{ id: string; status: string }> };
        }>;
      }>("orders.authorize", `/v2/checkout/orders/${orderId}/authorize`, {
        body: {},
        requestId: opts.requestId ?? `${orderId}:authorize`,
      });
      const auth = json.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!auth)
        throw new PayPalError(
          "orders.authorize",
          200,
          "no authorization in response",
        );
      return {
        orderId: json.id,
        authorizationId: auth.id,
        status: auth.status,
      };
    },

    async captureAuthorization(
      authorizationId: string,
      opts: { requestId?: string } = {},
    ): Promise<CaptureResult> {
      const json = await call<{ id: string; status: string }>(
        "payments.capture",
        `/v2/payments/authorizations/${authorizationId}/capture`,
        {
          body: { final_capture: true },
          requestId: opts.requestId ?? `${authorizationId}:capture`,
        },
      );
      return { captureId: json.id, status: json.status };
    },

    async voidAuthorization(
      authorizationId: string,
      opts: { requestId?: string } = {},
    ): Promise<void> {
      await call<void>(
        "payments.void",
        `/v2/payments/authorizations/${authorizationId}/void`,
        { requestId: opts.requestId ?? `${authorizationId}:void` },
      );
    },

    async reauthorizeAuthorization(
      authorizationId: string,
      input: { amount: number; currency?: string; requestId?: string },
    ): Promise<AuthorizeResult> {
      const json = await call<{ id: string; status: string }>(
        "payments.reauthorize",
        `/v2/payments/authorizations/${authorizationId}/reauthorize`,
        {
          body: {
            amount: {
              currency_code: input.currency ?? "USD",
              value: money(input.amount),
            },
          },
          requestId: input.requestId ?? `${authorizationId}:reauthorize`,
        },
      );
      return { orderId: "", authorizationId: json.id, status: json.status };
    },

    /**
     * Pay a vendor via the Payouts API (one EMAIL item per batch).
     * `senderBatchId` must be unique per payout: PayPal rejects a reused one,
     * so it doubles as the idempotency key (also the default PayPal-Request-Id).
     */
    async createPayout(input: {
      senderBatchId: string;
      receiver: string;
      amount: number;
      currency?: string;
      note?: string;
      emailSubject?: string;
      senderItemId?: string;
      requestId?: string;
    }): Promise<PayoutResult> {
      const json = await call<{
        batch_header: { payout_batch_id: string; batch_status: string };
      }>("payouts.create", "/v1/payments/payouts", {
        body: {
          sender_batch_header: {
            sender_batch_id: input.senderBatchId,
            email_subject: input.emailSubject ?? "You have a payout",
          },
          items: [
            {
              recipient_type: "EMAIL",
              amount: {
                value: money(input.amount),
                currency: input.currency ?? "USD",
              },
              receiver: input.receiver,
              ...(input.note ? { note: input.note } : {}),
              sender_item_id: input.senderItemId ?? input.senderBatchId,
            },
          ],
        },
        requestId: input.requestId ?? input.senderBatchId,
      });
      return {
        payoutBatchId: json.batch_header.payout_batch_id,
        batchStatus: json.batch_header.batch_status,
      };
    },

    /**
     * Ask PayPal whether a webhook delivery is authentic
     * (POST /v1/notifications/verify-webhook-signature). Never throws: a
     * missing transmission header, a missing webhookId, an unparseable body,
     * or any PayPal/network failure all count as unverified (false).
     */
    async verifyWebhookSignature(
      headers: HeaderSource,
      rawBody: string,
    ): Promise<boolean> {
      if (!config.webhookId) return false;
      const transmission: Record<string, string> = {};
      for (const [field, name] of Object.entries(WEBHOOK_SIGNATURE_HEADERS)) {
        const value = readHeader(headers, name);
        if (!value) return false;
        transmission[field] = value;
      }
      let event: unknown;
      try {
        event = JSON.parse(rawBody);
      } catch {
        return false;
      }
      try {
        const json = await call<{ verification_status?: string }>(
          "notifications.verify-webhook-signature",
          "/v1/notifications/verify-webhook-signature",
          {
            body: {
              ...transmission,
              webhook_id: config.webhookId,
              webhook_event: event,
            },
            requestId: null,
          },
        );
        return json?.verification_status === "SUCCESS";
      } catch (err) {
        // Status only — never the token, secret, or PayPal's full payload.
        console.error(
          "paypal webhook verification failed:",
          err instanceof PayPalError ? `HTTP ${err.status}` : String(err),
        );
        return false;
      }
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

/** Build a client from PAYPAL_* env vars. Throws if credentials are missing. */
export function payPalClientFromEnv(): PayPalClient {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)",
    );
  }
  return createPayPalClient({
    clientId,
    clientSecret,
    apiBase: process.env.PAYPAL_API_BASE,
    webhookId: process.env.PAYPAL_WEBHOOK_ID,
  });
}

/** Header that marks a hand-made webhook as acceptable in mock mode. */
export const MOCK_WEBHOOK_HEADER = "x-mock-webhook";

/**
 * Verify an inbound PayPal webhook using the env configuration.
 *
 * - PAYPAL_MODE=mock (DEMO ONLY): accepted iff the request carries
 *   `x-mock-webhook: 1`, so the demo can replay events with curl and no
 *   PayPal account. Never set PAYPAL_MODE=mock on a public deployment: anyone
 *   who knows the header could drive escrow state.
 * - Otherwise: PayPal's verify-webhook-signature with PAYPAL_WEBHOOK_ID.
 *   Missing credentials or webhook id => unverified.
 */
export async function verifyPayPalWebhook(
  headers: HeaderSource,
  rawBody: string,
  deps: { client?: () => PayPalClient } = {},
): Promise<boolean> {
  if (isMockMode()) return readHeader(headers, MOCK_WEBHOOK_HEADER) === "1";
  let client: PayPalClient;
  try {
    client = (deps.client ?? payPalClientFromEnv)();
  } catch {
    console.error("paypal webhook rejected: PayPal credentials not configured");
    return false;
  }
  return client.verifyWebhookSignature(headers, rawBody);
}
