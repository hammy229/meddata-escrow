import { POST as queryApi } from "../../app/api/query/route";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import {
  register,
  completeSetup,
  sessionAccount,
  createSession,
} from "../auth/store";
import { withDb, listDatasets, createOrder, listUsage } from "../db/store";
import {
  saveConnection,
  listConnections,
  getConnection,
  publishDataset,
  deleteConnection,
  datasetSource,
} from "./store";
import type { SourceFactory } from "./postgres";
import { availableCatalog } from "../catalog/live";
import {
  GET as listApi,
  POST as connectApi,
} from "../../app/api/connections/route";

test("owned provider connection can publish a live dataset without exposing credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meddata-source-"));
  const vars = [
    "DATABASE_URL",
    "CONNECTION_ENCRYPTION_KEY",
    "PROVIDER_DATABASE_HOSTS",
    "PROVIDER_DATABASE_ALLOW_LOCAL",
  ] as const;
  const saved = vars.map((k) => process.env[k]);
  process.env.DATABASE_URL = join(dir, "app.sqlite");
  process.env.CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PROVIDER_DATABASE_HOSTS = "127.0.0.1";
  process.env.PROVIDER_DATABASE_ALLOW_LOCAL = "true";
  const pg = await PGlite.create();
  const factory: SourceFactory = () => ({
    connect: async () => {
      await pg.exec("SET ROLE research_reader");
    },
    query: async (sql, params) => ({
      rows: (await pg.query(sql, params)).rows as Record<string, unknown>[],
    }),
    end: async () => {
      await pg.exec("ROLLBACK; RESET ROLE");
    },
  });
  try {
    await pg.exec(
      "CREATE TABLE public.research_records (dataset_id text, age numeric); INSERT INTO public.research_records SELECT 'cardio', 40 FROM generate_series(1,1200); CREATE ROLE research_reader NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO research_reader; GRANT SELECT ON public.research_records TO research_reader;",
    );
    const account = await register({
      name: "Provider",
      email: "provider@example.test",
      password: "test password for sources",
      role: "vendor",
    });
    await completeSetup(account, {
      organization: "Synthetic Warehouse",
      purpose: "Synthetic cardiovascular cohorts",
      payoutEmail: "payout@example.test",
    });
    const token = await createSession(account.id),
      ready = (await sessionAccount(token))!;
    const id = await saveConnection(
      ready,
      {
        label: "Research",
        connectionString:
          "postgres://reader:secret-password@127.0.0.1/research?sslmode=disable",
        schemaName: "public",
        tableName: "research_records",
      },
      factory,
    );
    const listed = await listConnections(ready);
    assert.equal(listed.length, 1);
    assert.ok(!JSON.stringify(listed).includes("secret-password"));
    await assert.rejects(
      getConnection(id, "another-vendor"),
      /Connection not found/,
    );
    const datasetId = await publishDataset(
      ready,
      {
        connectionId: id,
        datasetKey: "cardio",
        title: "Live cardiology cohort",
        description:
          "Synthetic cardiology data from a live PostgreSQL database",
        priceCents: 4900,
        synthetic: true,
      },
      factory,
    );
    assert.equal((await withDb((db) => listDatasets(db)))[0].recordCount, 1200);
    assert.equal(
      (await availableCatalog()).find((d) => d.id === datasetId)?.title,
      "Live cardiology cohort",
    );
    assert.equal((await datasetSource(datasetId))?.datasetKey, "cardio");
    await assert.rejects(deleteConnection(ready, id), /used by a dataset/);
    const encrypted = (await withDb((db) =>
      db
        .prepare(
          "SELECT encrypted_config FROM provider_connections WHERE id = ?",
        )
        .get(id),
    )) as { encrypted_config: string };
    assert.ok(!encrypted.encrypted_config.includes("secret-password"));
    const response = await listApi(
      new Request("http://localhost/api/connections", {
        headers: { cookie: `meddata_session=${token}` },
      }),
    );
    assert.equal(response.status, 200);
    assert.ok(!(await response.text()).includes("secret-password"));
    assert.equal(
      (
        await connectApi(
          new Request("http://localhost/api/connections", { method: "POST" }),
        )
      ).status,
      401,
    );
    const researcher = await register({
      name: "Scientist",
      email: "scientist@example.test",
      password: "test password for sources",
      role: "researcher",
    });
    await completeSetup(researcher, {
      organization: "Lab",
      purpose: "Synthetic research study",
      payoutEmail: "",
    });
    const researcherToken = await createSession(researcher.id);
    assert.equal(
      (
        await listApi(
          new Request("http://localhost/api/connections", {
            headers: { cookie: `meddata_session=${researcherToken}` },
          }),
        )
      ).status,
      403,
    );

    const paidOrder = await withDb((db) =>
      createOrder(db, {
        datasetId,
        buyerEmail: researcher.email,
        accountId: researcher.id,
        amountCents: 4900,
        status: "DELIVERED",
      }),
    );
    delete process.env.PROVIDER_DATABASE_HOSTS;
    const failedQuery = await queryApi(
      new Request("http://localhost/api/query", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `meddata_session=${researcherToken}`,
        },
        body: JSON.stringify({
          orderId: paidOrder.id,
          datasetId,
          question: "How many records are there?",
        }),
      }),
    );
    assert.equal(failedQuery.status, 503);
    assert.equal(
      (await withDb((db) => listUsage(db, paidOrder.id))).length,
      0,
      "failed live queries must never be billed or mocked",
    );
  } finally {
    for (const [i, key] of vars.entries()) {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    }
    await pg.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
