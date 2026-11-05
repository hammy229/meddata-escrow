import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { encryptSecret, decryptSecret } from "./secrets";
import {
  addressAllowed,
  aggregateSql,
  inspectSource,
  executeSource,
  sourceConfig,
  type SourceFactory,
} from "./postgres";
const credentials = {
  connectionString: "postgresql://reader:secret@127.0.0.1/test?sslmode=disable",
  schemaName: "public",
  tableName: "research_records",
};

test("connection secrets are encrypted, authenticated, and bound to their owner", () => {
  const saved = process.env.CONNECTION_ENCRYPTION_KEY;
  process.env.CONNECTION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const value = encryptSecret("sensitive-password", "owner:id");
    assert.ok(!value.includes("sensitive-password"));
    assert.equal(decryptSecret(value, "owner:id"), "sensitive-password");
    assert.throws(() => decryptSecret(value, "other:id"));
    assert.throws(() =>
      decryptSecret(value.slice(0, -5) + "AAAAA", "owner:id"),
    );
    delete process.env.CONNECTION_ENCRYPTION_KEY;
    assert.throws(() => encryptSecret("value", "owner"));
  } finally {
    if (saved === undefined) delete process.env.CONNECTION_ENCRYPTION_KEY;
    else process.env.CONNECTION_ENCRYPTION_KEY = saved;
  }
});
test("source addresses and identifiers are restricted", () => {
  for (const ip of [
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "10.1.2.3",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
  ])
    assert.equal(addressAllowed(ip), false, ip);
  assert.equal(addressAllowed("127.0.0.1", true), true);
  assert.equal(addressAllowed("8.8.8.8"), true);
  assert.throws(() =>
    aggregateSql(
      { ...credentials, tableName: "records; DROP TABLE users" },
      { op: "count", field: null, groupBy: null },
    ),
  );
  assert.match(
    aggregateSql(credentials, { op: "avg", field: "age", groupBy: "sex" }).sql,
    /COUNT\(\*\) AS "_cell_count"/,
  );
});

test("live source queries execute read-only aggregates with real PostgreSQL suppression", async () => {
  const pg = await PGlite.create();
  const savedHosts = process.env.PROVIDER_DATABASE_HOSTS,
    savedLocal = process.env.PROVIDER_DATABASE_ALLOW_LOCAL;
  process.env.PROVIDER_DATABASE_HOSTS = "127.0.0.1";
  process.env.PROVIDER_DATABASE_ALLOW_LOCAL = "true";
  const queries: string[] = [];
  const factory: SourceFactory = () => ({
    connect: async () => {
      await pg.exec("SET ROLE research_reader");
    },
    query: async (sql, params) => {
      queries.push(sql);
      return {
        rows: (await pg.query(sql, params)).rows as Record<string, unknown>[],
      };
    },
    end: async () => {
      await pg.exec("ROLLBACK; RESET ROLE");
    },
  });
  try {
    await pg.exec(
      "CREATE TABLE public.research_records (dataset_id text, sex text, age numeric); INSERT INTO public.research_records SELECT 'cohort', CASE WHEN n <= 20 THEN 'female' ELSE 'male' END, 40 FROM generate_series(1,25) n; INSERT INTO public.research_records SELECT 'three', CASE WHEN n <= 5 THEN 'small' WHEN n <= 25 THEN 'middle' ELSE 'large' END, 40 FROM generate_series(1,65) n; CREATE ROLE research_reader NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO research_reader; GRANT SELECT ON public.research_records TO research_reader;",
    );
    assert.deepEqual((await inspectSource(credentials, factory)).fields, [
      "sex",
      "age",
    ]);
    assert.deepEqual(
      await executeSource(
        credentials,
        "cohort",
        { op: "count", field: null, groupBy: "sex" },
        factory,
      ),
      // Showing female would give away male by subtraction from the total.
      [],
    );
    assert.deepEqual(
      await executeSource(
        credentials,
        "three",
        { op: "count", field: null, groupBy: "sex" },
        factory,
      ),
      // small is under the floor, and middle is hidden so it cannot be subtracted.
      [{ group: "large", count: 40 }],
    );
    assert.deepEqual(
      await executeSource(
        credentials,
        "cohort",
        { op: "avg", field: "age", groupBy: "sex" },
        factory,
      ),
      [],
    );
    assert.deepEqual(
      await executeSource(
        credentials,
        "missing",
        { op: "count", field: null, groupBy: null },
        factory,
      ),
      [],
    );
    assert.ok(queries.includes("BEGIN READ ONLY"));
    assert.ok(!queries.some((q) => /SELECT\s+\*/i.test(q)));
    delete process.env.PROVIDER_DATABASE_HOSTS;
    await assert.rejects(sourceConfig(credentials), /PROVIDER_DATABASE_HOSTS/);
    process.env.PROVIDER_DATABASE_HOSTS = "127.0.0.1";
    await pg.exec("GRANT UPDATE ON public.research_records TO research_reader");
    await assert.rejects(inspectSource(credentials, factory), /SELECT-only/);
  } finally {
    if (savedHosts === undefined) delete process.env.PROVIDER_DATABASE_HOSTS;
    else process.env.PROVIDER_DATABASE_HOSTS = savedHosts;
    if (savedLocal === undefined)
      delete process.env.PROVIDER_DATABASE_ALLOW_LOCAL;
    else process.env.PROVIDER_DATABASE_ALLOW_LOCAL = savedLocal;
    await pg.close();
  }
});
