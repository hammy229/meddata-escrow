// PayPal Orders v2 / Payments client for the escrow flow (sandbox or live).
//
// Flow: createAuthorizeOrder (intent=AUTHORIZE) -> buyer approves -> authorizeOrder
// -> captureAuthorization (on delivery) | voidAuthorization (on failure) |
// reauthorizeAuthorization (past PayPal's 3-day honor period).
//
// Security: credentials come only from the injected config (sourced from env
// in payPalClientFromEnv). The client secret and access token are never logged
// or included in thrown errors. All traffic is HTTPS to PAYPAL_API_BASE.

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  apiBase?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
}

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
    const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
    const res = await doFetch(`${base}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalError("oauth2/token", res.status, await res.text());
    const json = (await res.json()) as { access_token: string; expires_in: number };
    token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return token.value;
  }

  async function call<T>(
    endpoint: string,
    path: string,
    init: { body?: unknown; requestId?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await accessToken()}`,
      "Content-Type": "application/json",
    };
    // PayPal-Request-Id makes capture/reauthorize safe to retry (idempotency).
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
    }): Promise<CreateOrderResult> {
      const body = {
        intent: "AUTHORIZE",
        purchase_units: [
          {
            ...(input.referenceId ? { reference_id: input.referenceId } : {}),
            amount: { currency_code: input.currency ?? "USD", value: money(input.amount) },
          },
        ],
      };
      const json = await call<{ id: string; status: string; links?: Array<{ rel: string; href: string }> }>(
        "orders.create",
        "/v2/checkout/orders",
        { body },
      );
      return {
        orderId: json.id,
        status: json.status,
        approveUrl: json.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href,
      };
    },

    async authorizeOrder(orderId: string): Promise<AuthorizeResult> {
      const json = await call<{
        id: string;
        purchase_units?: Array<{ payments?: { authorizations?: Array<{ id: string; status: string }> } }>;
      }>("orders.authorize", `/v2/checkout/orders/${orderId}/authorize`, { body: {} });
      const auth = json.purchase_units?.[0]?.payments?.authorizations?.[0];
      if (!auth) throw new PayPalError("orders.authorize", 200, "no authorization in response");
      return { orderId: json.id, authorizationId: auth.id, status: auth.status };
    },

    async captureAuthorization(
      authorizationId: string,
      opts: { requestId?: string } = {},
    ): Promise<CaptureResult> {
      const json = await call<{ id: string; status: string }>(
        "payments.capture",
        `/v2/payments/authorizations/${authorizationId}/capture`,
        { body: { final_capture: true }, requestId: opts.requestId },
      );
      return { captureId: json.id, status: json.status };
    },

    async voidAuthorization(authorizationId: string): Promise<void> {
      await call<void>("payments.void", `/v2/payments/authorizations/${authorizationId}/void`);
    },

    async reauthorizeAuthorization(
      authorizationId: string,
      input: { amount: number; currency?: string; requestId?: string },
    ): Promise<AuthorizeResult> {
      const json = await call<{ id: string; status: string }>(
        "payments.reauthorize",
        `/v2/payments/authorizations/${authorizationId}/reauthorize`,
        {
          body: { amount: { currency_code: input.currency ?? "USD", value: money(input.amount) } },
          requestId: input.requestId,
        },
      );
      return { orderId: "", authorizationId: json.id, status: json.status };
    },
  };
}

export type PayPalClient = ReturnType<typeof createPayPalClient>;

/** Build a client from PAYPAL_* env vars. Throws if credentials are missing. */
export function payPalClientFromEnv(): PayPalClient {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set (see .env.example)");
  }
  return createPayPalClient({ clientId, clientSecret, apiBase: process.env.PAYPAL_API_BASE });
}
