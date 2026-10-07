// PayPal Orders v2 client spec. Uses an injected fake fetch — no network,
// no real credentials. Asserts request shapes (auth, intent, idempotency
// headers) and response parsing, plus error handling on non-2xx.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPayPalClient, PayPalError } from "./client";

type Handler = (init: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => {
  status: number;
  body?: unknown;
};

function fakeFetch(routes: Record<string, Handler>) {
  const calls: Array<{
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }> = [];
  const fn = (async (url: string | URL, init: Record<string, unknown> = {}) => {
    const u = String(url);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      url: u,
      method: (init.method as string) ?? "GET",
      headers,
      body: init.body as string,
    });
    const key = Object.keys(routes).find((k) => u.endsWith(k));
    if (!key) throw new Error(`fakeFetch: no route for ${u}`);
    const { status, body } = routes[key](init as never);
    return {
      ok: status >= 200 && status < 300,
      status,
      async json() {
        return body;
      },
      async text() {
        return body === undefined ? "" : JSON.stringify(body);
      },
    };
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const CREDS = {
  clientId: "cid",
  clientSecret: "csecret",
  apiBase: "https://api-m.sandbox.paypal.com",
};

const TOKEN_OK: Handler = () => ({
  status: 200,
  body: { access_token: "tok-123", token_type: "Bearer", expires_in: 32400 },
});

test("fetches an OAuth token with Basic auth and caches it across calls", async () => {
  const { fn, calls } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/checkout/orders": () => ({
      status: 201,
      body: { id: "O1", status: "CREATED", links: [] },
    }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  await pp.createAuthorizeOrder({ amount: 10 });
  await pp.createAuthorizeOrder({ amount: 20 });

  const tokenCalls = calls.filter((c) => c.url.endsWith("/v1/oauth2/token"));
  assert.equal(tokenCalls.length, 1, "token should be cached, fetched once");
  const expectedBasic =
    "Basic " + Buffer.from("cid:csecret").toString("base64");
  assert.equal(tokenCalls[0].headers.Authorization, expectedBasic);
  assert.match(tokenCalls[0].body ?? "", /grant_type=client_credentials/);
});

test("createAuthorizeOrder sends intent=AUTHORIZE and returns id + approve url", async () => {
  const { fn, calls } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/checkout/orders": () => ({
      status: 201,
      body: {
        id: "ORDER-1",
        status: "CREATED",
        links: [
          {
            rel: "approve",
            href: "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
          },
        ],
      },
    }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  const res = await pp.createAuthorizeOrder({
    amount: 42.5,
    currency: "USD",
    referenceId: "order-7",
  });

  const orderCall = calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
  assert.equal(orderCall.method, "POST");
  assert.equal(orderCall.headers.Authorization, "Bearer tok-123");
  const sent = JSON.parse(orderCall.body!);
  assert.equal(sent.intent, "AUTHORIZE");
  assert.equal(sent.purchase_units[0].amount.currency_code, "USD");
  assert.equal(sent.purchase_units[0].amount.value, "42.50");
  assert.equal(sent.purchase_units[0].reference_id, "order-7");

  assert.equal(res.orderId, "ORDER-1");
  assert.equal(
    res.approveUrl,
    "https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1",
  );
});

test("authorizeOrder extracts the authorization id from the order", async () => {
  const { fn } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/checkout/orders/ORDER-1/authorize": () => ({
      status: 201,
      body: {
        id: "ORDER-1",
        status: "COMPLETED",
        purchase_units: [
          {
            payments: { authorizations: [{ id: "AUTH-9", status: "CREATED" }] },
          },
        ],
      },
    }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  const res = await pp.authorizeOrder("ORDER-1");
  assert.equal(res.authorizationId, "AUTH-9");
  assert.equal(res.status, "CREATED");
});

test("captureAuthorization sends PayPal-Request-Id for idempotency", async () => {
  const { fn, calls } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/payments/authorizations/AUTH-9/capture": () => ({
      status: 201,
      body: { id: "CAP-1", status: "COMPLETED" },
    }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  const res = await pp.captureAuthorization("AUTH-9", { requestId: "req-abc" });

  const call = calls.find((c) => c.url.endsWith("/capture"))!;
  assert.equal(call.headers["PayPal-Request-Id"], "req-abc");
  assert.equal(JSON.parse(call.body!).final_capture, true);
  assert.equal(res.captureId, "CAP-1");
  assert.equal(res.status, "COMPLETED");
});

test("reauthorizeAuthorization sends amount and an idempotency key", async () => {
  const { fn, calls } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/payments/authorizations/AUTH-9/reauthorize": () => ({
      status: 201,
      body: { id: "AUTH-9", status: "CREATED" },
    }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  await pp.reauthorizeAuthorization("AUTH-9", {
    amount: 15,
    requestId: "req-reauth",
  });

  const call = calls.find((c) => c.url.endsWith("/reauthorize"))!;
  assert.equal(call.headers["PayPal-Request-Id"], "req-reauth");
  assert.equal(JSON.parse(call.body!).amount.value, "15.00");
});

test("voidAuthorization posts to the void endpoint", async () => {
  const { fn, calls } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/payments/authorizations/AUTH-9/void": () => ({ status: 204 }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  await pp.voidAuthorization("AUTH-9");
  assert.ok(calls.some((c) => c.url.endsWith("/void") && c.method === "POST"));
});

test("throws PayPalError with the HTTP status on a non-2xx response", async () => {
  const { fn } = fakeFetch({
    "/v1/oauth2/token": TOKEN_OK,
    "/v2/checkout/orders": () => ({
      status: 422,
      body: { name: "UNPROCESSABLE_ENTITY" },
    }),
  });
  const pp = createPayPalClient({ ...CREDS, fetch: fn });
  await assert.rejects(
    () => pp.createAuthorizeOrder({ amount: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof PayPalError);
      assert.equal((err as PayPalError).status, 422);
      return true;
    },
  );
});
