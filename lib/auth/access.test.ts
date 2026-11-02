import { POST as issueMandateApi } from "../../app/api/mandates/route";
import { GET as insightsApi } from "../../app/api/insights/route";
import { GET as trustApi } from "../../app/api/trust/route";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  register,
  authenticate,
  createSession,
  sessionAccount,
  deleteSession,
  completeSetup,
  SESSION_COOKIE,
  type Account,
} from "./store";
import { secure } from "./access";
import { GET as billingGet } from "../../app/api/billing/route";
import { POST as queryPost } from "../../app/api/query/route";
import { POST as agentPost, GET as agentGet } from "../../app/api/agent/route";
import { seedDatabase } from "../db/seed";
import { withDb, createOrder } from "../db/client";
import {
  GET as ordersGet,
  POST as ordersPost,
  PATCH as ordersPatch,
} from "../../app/api/orders/route";
import {
  GET as datasetsGet,
  PATCH as datasetsPatch,
} from "../../app/api/datasets/route";
import { POST as authPost } from "../../app/api/auth/[action]/route";
const password = "test password long enough";
test("persistent account lifecycle and API isolation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "meddata-auth-"));
  const saved = process.env.DATABASE_URL;
  const mode = process.env.PAYPAL_MODE;
  process.env.DATABASE_URL = join(dir, "auth.sqlite");
  process.env.PAYPAL_MODE = "mock";
  try {
    const researcher = await register({
      name: "Alice Researcher",
      email: "ALICE@example.com",
      password,
      role: "researcher",
    });
    const other = await register({
      name: "Bob Researcher",
      email: "bob@example.com",
      password,
      role: "researcher",
    });
    const vendor = await register({
      name: "Data Provider",
      email: "vendor@example.com",
      password,
      role: "vendor",
    });
    const token = await createSession(researcher.id);
    const otherToken = await createSession(other.id);
    const vendorToken = await createSession(vendor.id);
    const req = (
      path: string,
      token?: string,
      method = "GET",
      body?: unknown,
    ) =>
      new Request(`http://localhost${path}`, {
        method,
        headers: {
          ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const ready = async (account: Account) => {
      await completeSetup(account, {
        organization: "Test Institution",
        purpose: "Research using synthetic cohorts",
        payoutEmail: account.role === "vendor" ? "payout@example.com" : "",
      });
      return (await sessionAccount(await createSession(account.id)))!;
    };
    await t.test(
      "password verification, normalization, and token storage",
      async () => {
        assert.equal(researcher.email, "alice@example.com");
        assert.equal(
          (await authenticate("ALICE@example.com", password))?.id,
          researcher.id,
        );
        assert.equal(
          await authenticate("alice@example.com", "wrong password"),
          null,
        );
        assert.equal(await authenticate("missing@example.com", password), null);
        assert.equal(await sessionAccount("forged"), null);
        assert.equal(
          withDb((db) =>
            db
              .prepare("SELECT 1 FROM sessions WHERE token_hash = ?")
              .get(token),
          ),
          undefined,
        );
        await assert.rejects(
          register({
            name: "Duplicate",
            email: researcher.email,
            password,
            role: "vendor",
          }),
        );
      },
    );
    await t.test(
      "signed-out and incomplete accounts cannot use APIs",
      async () => {
        assert.equal((await ordersGet(req("/api/orders"))).status, 401);
        assert.equal((await ordersGet(req("/api/orders", token))).status, 403);
      },
    );
    const readyVendor = await ready(vendor);
    await ready(researcher);
    await ready(other);
    const order = withDb((db) => {
      db.prepare(
        "INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)",
      ).run("ds_owned", readyVendor.vendor_id, "Synthetic data", 4900);
      db.prepare(
        "INSERT INTO vendors (id, name) VALUES ('unrelated', 'Other provider')",
      ).run();
      db.prepare(
        "INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES ('ds_other', 'unrelated', 'Other dataset', 8000)",
      ).run();
      return createOrder(db, {
        datasetId: "ds_owned",
        buyerEmail: researcher.email,
        accountId: researcher.id,
        amountCents: 4900,
      });
    });
    await t.test(
      "list, detail, summary and price edits respect ownership",
      async () => {
        assert.equal(
          (await (await ordersGet(req("/api/orders", otherToken))).json())
            .orders.length,
          0,
        );
        assert.equal(
          (await (await ordersGet(req("/api/orders", token))).json()).orders
            .length,
          1,
        );
        assert.equal(
          (
            await ordersGet(
              req(`/api/orders?id=${order.id}&receipt=1`, otherToken),
            )
          ).status,
          404,
        );
        const summary = await (
          await ordersGet(req("/api/orders?summary=1", vendorToken))
        ).json();
        assert.equal(summary.summary.countsByStatus.MATCHED, 1);
        const catalog = await (
          await datasetsGet(req("/api/datasets", vendorToken))
        ).json();
        assert.deepEqual(
          catalog.datasets.map((d: { id: string }) => d.id),
          ["ds_owned"],
        );
        assert.equal(
          (
            await datasetsPatch(
              req("/api/datasets", vendorToken, "PATCH", {
                datasetId: "ds_other",
                priceCents: 100,
              }),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await datasetsPatch(
              req("/api/datasets", token, "PATCH", {
                datasetId: "ds_owned",
                priceCents: 100,
              }),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await datasetsPatch(
              req("/api/datasets", vendorToken, "PATCH", {
                datasetId: "ds_owned",
                priceCents: 5100,
              }),
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "purchase identity is server-derived and role actions are enforced",
      async () => {
        const res = await ordersPost(
          req("/api/orders", otherToken, "POST", {
            datasetId: "ds_owned",
            buyerEmail: researcher.email,
          }),
        );
        assert.equal(res.status, 201);
        const rows = withDb((db) =>
          db
            .prepare("SELECT buyer_email FROM orders WHERE buyer_email = ?")
            .all(other.email),
        );
        assert.equal(rows.length, 1);
        assert.equal(
          (
            await ordersPatch(
              req("/api/orders", token, "PATCH", {
                orderId: order.id,
                action: "deliver",
              }),
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await ordersPost(
              req("/api/orders", vendorToken, "POST", {
                datasetId: "ds_owned",
              }),
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "cross-site writes and other users' audit runs are rejected",
      async () => {
        const cross = req("/api/orders", token, "POST", {});
        cross.headers.set("origin", "https://attacker.example");
        assert.equal((await ordersPost(cross)).status, 403);
        const check = secure(async () => Response.json({ ok: true }));
        assert.equal(
          (await check(req("/api/agent?runId=other_run", token))).status,
          404,
        );
      },
    );
    await t.test(
      "an own order id in the URL cannot unlock another order in the body",
      async () => {
        const created = await ordersPost(
          req("/api/orders", otherToken, "POST", { datasetId: "ds_owned" }),
        );
        const { orderId: ownId } = await created.json();
        const smuggled = await ordersPatch(
          req(`/api/orders?orderId=${ownId}`, otherToken, "PATCH", {
            orderId: order.id,
            action: "cancel",
          }),
        );
        assert.equal(smuggled.status, 404);
        assert.equal(
          (
            await ordersGet(
              req(
                `/api/orders?orderId=${ownId}&id=${order.id}&events=1`,
                otherToken,
              ),
            )
          ).status,
          404,
        );
        const untouched = await (
          await ordersGet(req(`/api/orders?id=${order.id}`, token))
        ).json();
        assert.equal(untouched.order.status, "MATCHED");
      },
    );
    await t.test(
      "researcher and provider can complete the authenticated escrow lifecycle",
      async () => {
        const created = await ordersPost(
          req("/api/orders", otherToken, "POST", { datasetId: "ds_owned" }),
        );
        const { orderId } = await created.json();
        for (const [action, actor] of [
          ["authorize", otherToken],
          ["deliver", vendorToken],
          ["capture", otherToken],
          ["payout", vendorToken],
        ]) {
          const result = await ordersPatch(
            req("/api/orders", actor, "PATCH", { orderId, action }),
          );
          assert.equal(result.status, 200, `${action}: ${await result.text()}`);
        }
        assert.equal(
          (
            await queryPost(
              req("/api/query", token, "POST", {
                orderId,
                datasetId: "ds_owned",
                question: "How many records?",
              }),
            )
          ).status,
          404,
        );
        assert.equal(
          (await billingGet(req(`/api/billing?orderId=${orderId}`, token)))
            .status,
          404,
        );
        assert.equal(
          (
            await billingGet(
              req(`/api/billing?orderId=${orderId}`, vendorToken),
            )
          ).status,
          200,
        );
      },
    );
    await t.test(
      "historical orders cannot be claimed by matching buyer email",
      async () => {
        const historical = withDb((db) =>
          createOrder(db, {
            datasetId: "ds_owned",
            buyerEmail: researcher.email,
            amountCents: 5100,
            paypalOrderId: "OLD-ORDER",
          }),
        );
        assert.equal(
          (await ordersGet(req(`/api/orders?id=${historical.id}`, token)))
            .status,
          404,
        );
        const created = await ordersPost(
          req("/api/orders", token, "POST", { datasetId: "ds_owned" }),
        );
        assert.notEqual((await created.json()).orderId, historical.id);
      },
    );
    await t.test(
      "procurement runs and their orders belong to the requesting account",
      async () => {
        withDb((db) => seedDatabase(db));
        const result = await agentPost(
          req("/api/agent", token, "POST", {
            study: "cardiology heart disease",
            budgetCents: 10000,
            buyerEmail: other.email,
          }),
        );
        assert.equal(result.status, 200);
        const run = await result.json();
        assert.equal(
          (await agentGet(req(`/api/agent?runId=${run.runId}`, token))).status,
          200,
        );
        assert.equal(
          (await agentGet(req(`/api/agent?runId=${run.runId}`, otherToken)))
            .status,
          404,
        );
        if (run.order) {
          const response = await ordersGet(
            req(`/api/orders?id=${run.order.orderId}`, token),
          );
          assert.equal(response.status, 200);
          assert.equal((await response.json()).order.account_id, researcher.id);
        }
      },
    );
    await t.test(
      "merged mandate, trust, and insights APIs retain account boundaries",
      async () => {
        assert.equal(
          (
            await issueMandateApi(
              req("/api/mandates", undefined, "POST", { maxTotalCents: 10000 }),
            )
          ).status,
          401,
        );
        const issued = await issueMandateApi(
          req("/api/mandates", otherToken, "POST", {
            maxTotalCents: 10000,
            buyerId: researcher.email,
          }),
        );
        assert.equal(issued.status, 200);
        const mandate = await issued.json();
        assert.equal(mandate.mandate.buyerId, other.email);
        const cross = await agentPost(
          req("/api/agent", token, "POST", {
            study: "cardiology",
            budgetCents: 10000,
            mandate: mandate.token,
          }),
        );
        assert.equal(cross.status, 403);
        assert.equal((await trustApi(req("/api/trust"))).status, 401);
        assert.equal((await trustApi(req("/api/trust", token))).status, 200);
        assert.equal((await insightsApi(req("/api/insights"))).status, 401);
        const scoped = await insightsApi(req("/api/insights", token));
        assert.equal(scoped.status, 200);
        const ownCount = withDb(
          (db) =>
            (
              db
                .prepare(
                  "SELECT COUNT(*) AS n FROM orders WHERE account_id = ?",
                )
                .get(researcher.id) as { n: number }
            ).n,
        );
        assert.equal((await scoped.json()).insights.orderCount, ownCount);
      },
    );
    await t.test("expiry and logout revoke access", async () => {
      const expired = await createSession(other.id);
      withDb((db) =>
        db
          .prepare("UPDATE sessions SET expires_at = 0 WHERE account_id = ?")
          .run(other.id),
      );
      assert.equal(await sessionAccount(expired), null);
      await deleteSession(token);
      assert.equal(await sessionAccount(token), null);
      assert.equal((await ordersGet(req("/api/orders", token))).status, 401);
    });
    await t.test("HTTP signup, setup, login and logout", async () => {
      const post = (action: string, request: Request) =>
        authPost(request, { params: Promise.resolve({ action }) });
      const signup = await post(
        "signup",
        req("/api/auth/signup", undefined, "POST", {
          name: "New Scientist",
          email: "new@example.com",
          password,
          role: "researcher",
        }),
      );
      assert.equal(signup.status, 200);
      assert.equal((await signup.json()).redirect, "/setup");
      const cookie = signup.headers.get("set-cookie")!;
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=lax/i);
      const newToken = cookie.split(";")[0].split("=")[1];
      const setup = await post(
        "setup",
        req("/api/auth/setup", newToken, "POST", {
          organization: "New University",
          purpose: "Synthetic cardiology research",
        }),
      );
      assert.equal((await setup.json()).redirect, "/researcher");
      const logout = await post(
        "logout",
        req("/api/auth/logout", newToken, "POST"),
      );
      assert.equal(logout.status, 200);
      assert.equal(await sessionAccount(newToken), null);
      const login = await post(
        "login",
        req("/api/auth/login", undefined, "POST", {
          email: "new@example.com",
          password,
        }),
      );
      assert.equal((await login.json()).redirect, "/researcher");
      const invalid = await post(
        "signup",
        req("/api/auth/signup", undefined, "POST", {
          name: "Oops",
          email: "oops@example.com",
          password: "short",
          role: "admin",
        }),
      );
      assert.equal(invalid.status, 400);
    });
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    if (mode === undefined) delete process.env.PAYPAL_MODE;
    else process.env.PAYPAL_MODE = mode;
    rmSync(dir, { recursive: true, force: true });
  }
});
