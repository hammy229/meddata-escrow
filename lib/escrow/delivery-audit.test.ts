// Delivery audit: what DELIVER does on a listing that makes claims. Pure audit
// first, then the one-transaction deliver (and dispute) on SQLite and PGlite,
// then the service flow end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

import {
  AUDIT_NOTE_PREFIX,
  applyDelivery,
  auditDelivery,
  auditSummary,
} from "./delivery-audit";
import { advanceEscrowOrder, type EscrowDeps } from "./service";
import { openDb } from "../db/client";
import {
  postgresConnection,
  sqliteConnection,
  type AppDatabase,
} from "../db/connection";
import { migratePostgres } from "../db/migrations";
import { seedDatabase } from "../db/seed";
import {
  advanceOrder,
  createOrder,
  getDeliveryAudit,
  getOrder,
  listOrderEvents,
} from "../db/store";
import { fixtureCohort } from "../fitness/source";
import type { EscrowTransition } from "../events/outbound";

const FLAWED = "ds_als_survival_axonpoint_v1";
const CLEAN = "ds_als_survival_motorneuron_v1";
const CURATED = "ds_als_survival_curated_v1";
const CARDIO = "ds_cardio_synthea_v1";

test("auditDelivery blocks a delivery that breaks a claim and stores evidence", () => {
  const a = auditDelivery({ id: "ord_1", dataset_id: CURATED })!;
  assert.equal(a.verdict, "fail");
  assert.equal(a.blocking, true);
  assert.equal(a.orderId, "ord_1");
  assert.equal(a.datasetId, CURATED);
  assert.match(a.fingerprint!, /^[0-9a-f]{64}$/);
  assert.equal(a.report?.stage, "delivery");
  assert.ok(a.claims && a.claims.subjects > 0);
  // Same bytes, same fingerprint.
  assert.equal(auditDelivery({ id: "ord_2", dataset_id: CURATED })!.fingerprint, a.fingerprint);
});

test("auditDelivery lets a clean delivery through", () => {
  const a = auditDelivery({ id: "o", dataset_id: CLEAN })!;
  assert.equal(a.verdict, "pass");
  assert.equal(a.blocking, false);
  assert.notEqual(
    a.fingerprint,
    auditDelivery({ id: "o", dataset_id: CURATED })!.fingerprint,
  );
});

test("a listing with no fixture is not audited", () => {
  assert.equal(auditDelivery({ id: "o", dataset_id: CARDIO }), null);
  assert.deepEqual(auditSummary(null), {
    verdict: "not_applicable",
    blocking: false,
  });
});

test("the summary carries only the verdict and whether it blocks", () => {
  const a = auditDelivery({ id: "o", dataset_id: FLAWED })!;
  assert.deepEqual(auditSummary(a), { verdict: "fail", blocking: true });
});

test("drift: the curated listing's flawed delivery differs from its clean sample", () => {
  const a = auditDelivery({ id: "o", dataset_id: CURATED })!;
  const drift = a.report!.findings.filter((f) => f.id === "drift");
  assert.ok(drift.length > 0 && drift.every((f) => f.severity === "warn"));
  assert.ok(drift.some((f) => f.column === "last_contact_alsfrs" && /added/.test(f.title)));
  assert.ok(drift.some((f) => f.column === "baseline_fvc_pct" && /missingness/.test(f.title)));
});

test("drift: a clean listing whose sample is its delivery does not drift, and drift never blocks", () => {
  const clean = auditDelivery({ id: "o", dataset_id: CLEAN })!;
  const drift = clean.report!.findings.filter((f) => f.id === "drift");
  assert.deepEqual(drift.map((f) => f.severity), ["pass"]);
  assert.equal(clean.verdict, "pass");
  // Drift alone is never a claim breach, so it cannot be the reason money is held.
  const curated = auditDelivery({ id: "o", dataset_id: CURATED })!;
  const withoutDrift = curated.report!.findings.filter((f) => f.id !== "drift");
  assert.equal(
    curated.blocking,
    withoutDrift.some((f) => f.id === "claim" && f.severity === "fail"),
  );
});

test("the audit output carries no subject keys", () => {
  const a = auditDelivery({ id: "o", dataset_id: CURATED })!;
  const text = JSON.stringify(a);
  assert.ok(!text.includes('"subject_key"'));
  assert.doesNotMatch(text, /"?subject_key"?:\s*"/);
  const key = String(fixtureCohort(CURATED, "delivery")!.subjects[0].subject_key);
  assert.ok(!text.includes(key));
});

// ---------------------------------------------------------------------------
// applyDelivery: SQLite and PGlite share one flow.

async function authorized(db: AppDatabase, datasetId: string) {
  const order = await createOrder(db, {
    datasetId,
    buyerEmail: "b@example.test",
    amountCents: 2900,
  });
  await advanceOrder(db, order.id, "AUTHORIZE", { authorizationId: "AUTH-1" });
  return order.id;
}

async function flow(db: AppDatabase) {
  const curated = await authorized(db, CURATED);
  const r1 = await applyDelivery(db, curated, auditDelivery({ id: curated, dataset_id: CURATED }));
  assert.equal(r1.delivered.status, "DELIVERED");
  assert.equal(r1.disputed?.status, "DISPUTED");
  const events = await listOrderEvents(db, curated);
  assert.deepEqual(
    events.map((e) => e.event),
    ["CREATE", "AUTHORIZE", "DELIVER", "DISPUTE"],
  );
  assert.ok(events[3].note?.startsWith(AUDIT_NOTE_PREFIX));
  assert.ok((events[3].note ?? "").length < 200);
  assert.equal((await getOrder(db, curated))?.status, "DISPUTED");
  const stored = (await getDeliveryAudit(db, curated))!;
  assert.equal(stored.blocking, true);
  assert.equal(stored.verdict, "fail");

  const clean = await authorized(db, CLEAN);
  const r2 = await applyDelivery(db, clean, auditDelivery({ id: clean, dataset_id: CLEAN }));
  assert.equal(r2.disputed, undefined);
  assert.equal((await getOrder(db, clean))?.status, "DELIVERED");
  assert.equal((await getDeliveryAudit(db, clean))?.blocking, false);

  const cardio = await authorized(db, CARDIO);
  const r3 = await applyDelivery(db, cardio, null, "sent");
  assert.equal(r3.delivered.status, "DELIVERED");
  assert.equal(await getDeliveryAudit(db, cardio), undefined);
  const e3 = await listOrderEvents(db, cardio);
  assert.deepEqual(e3.map((e) => e.event), ["CREATE", "AUTHORIZE", "DELIVER"]);
  assert.equal(e3[2].note, "sent");
}

test("deliver and dispute in one transaction on SQLite", async () => {
  const raw = openDb(":memory:");
  try {
    seedDatabase(raw);
    await flow(sqliteConnection(raw));
  } finally {
    raw.close();
  }
});

async function pgDb() {
  const pg = await PGlite.create();
  const db = postgresConnection({
    query: async (sql, params) => {
      const result =
        params === undefined
          ? (await pg.exec(sql)).at(-1)!
          : await pg.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
    },
  });
  await migratePostgres(db);
  await db
    .prepare("INSERT INTO vendors (id, name) VALUES (?, ?)")
    .run("vendor", "Test Provider");
  for (const id of [CURATED, CLEAN, CARDIO])
    await db
      .prepare(
        "INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)",
      )
      .run(id, "vendor", id, 2900);
  return { pg, db };
}

test("deliver and dispute in one transaction on PostgreSQL", async () => {
  const { pg, db } = await pgDb();
  try {
    await flow(db);
  } finally {
    await pg.close();
  }
});

test("if the dispute cannot be written, the audit and the delivery roll back (SQLite)", async () => {
  const raw = openDb(":memory:");
  try {
    seedDatabase(raw);
    const db = sqliteConnection(raw);
    const id = await authorized(db, CURATED);
    raw.exec(
      `CREATE TRIGGER no_dispute BEFORE INSERT ON order_events WHEN NEW.event = 'DISPUTE' BEGIN SELECT RAISE(ABORT, 'boom'); END`,
    );
    await assert.rejects(
      applyDelivery(db, id, auditDelivery({ id, dataset_id: CURATED })),
      /boom/,
    );
    assert.equal((await getOrder(db, id))?.status, "AUTHORIZED");
    assert.equal(await getDeliveryAudit(db, id), undefined);
    assert.equal((await listOrderEvents(db, id)).length, 2);
  } finally {
    raw.close();
  }
});

test("if the audit cannot be saved, nothing moves (SQLite)", async () => {
  const raw = openDb(":memory:");
  try {
    seedDatabase(raw);
    const db = sqliteConnection(raw);
    const id = await authorized(db, CLEAN);
    raw.exec(
      `CREATE TRIGGER no_audit BEFORE INSERT ON delivery_audits BEGIN SELECT RAISE(ABORT, 'nope'); END`,
    );
    await assert.rejects(
      applyDelivery(db, id, auditDelivery({ id, dataset_id: CLEAN })),
      /nope/,
    );
    assert.equal((await getOrder(db, id))?.status, "AUTHORIZED");
    assert.equal((await listOrderEvents(db, id)).length, 2);
  } finally {
    raw.close();
  }
});

test("if the dispute cannot be written, the audit and the delivery roll back (PostgreSQL)", async () => {
  const { pg, db } = await pgDb();
  try {
    const id = await authorized(db, CURATED);
    await db.exec(
      `CREATE FUNCTION refuse() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$ LANGUAGE plpgsql;
       CREATE TRIGGER no_dispute BEFORE INSERT ON order_events FOR EACH ROW WHEN (NEW.event = 'DISPUTE') EXECUTE FUNCTION refuse();`,
    );
    await assert.rejects(
      applyDelivery(db, id, auditDelivery({ id, dataset_id: CURATED })),
      /boom/,
    );
    assert.equal((await getOrder(db, id))?.status, "AUTHORIZED");
    assert.equal(await getDeliveryAudit(db, id), undefined);
    assert.equal((await listOrderEvents(db, id)).length, 2);
  } finally {
    await pg.close();
  }
});

// ---------------------------------------------------------------------------
// Service flow, mock mode, temp-file SQLite.

function withDbEnv(fn: (ctx: { url: string }) => Promise<void>) {
  return async () => {
    const path = join(tmpdir(), `meddata-audit-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const saved = {
      url: process.env.DATABASE_URL,
      mode: process.env.PAYPAL_MODE,
    };
    process.env.DATABASE_URL = url;
    process.env.PAYPAL_MODE = "mock";
    const db = openDb(url);
    seedDatabase(db);
    db.close();
    try {
      await fn({ url });
    } finally {
      const restore = (k: string, v: string | undefined) =>
        v === undefined ? delete process.env[k] : (process.env[k] = v);
      restore("DATABASE_URL", saved.url);
      restore("PAYPAL_MODE", saved.mode);
      rmSync(path, { force: true });
    }
  };
}

function seedAuthorized(url: string, datasetId: string): string {
  const db = openDb(url);
  const id = `ord_${randomUUID()}`;
  db.prepare(
    `INSERT INTO orders (id, dataset_id, buyer_email, status, amount_cents, authorization_id) VALUES (?, ?, 'b@example.test', 'AUTHORIZED', 2900, 'AUTH-1')`,
  ).run(id, datasetId);
  db.close();
  return id;
}

function recorder() {
  const seen: EscrowTransition[] = [];
  const deps: EscrowDeps = { emit: (t) => void seen.push(t) };
  return { seen, deps };
}

test(
  "service: the curated listing ends DISPUTED with two events and a stored audit",
  withDbEnv(async ({ url }) => {
    const id = seedAuthorized(url, CURATED);
    const { seen, deps } = recorder();
    const res = await advanceEscrowOrder({ orderId: id, action: "deliver" }, deps);
    assert.equal(res.escrowState, "DISPUTED");
    assert.deepEqual(res.audit, { verdict: "fail", blocking: true });
    assert.deepEqual(
      seen.map((t) => [t.event, t.from, t.to]),
      [
        ["DELIVER", "AUTHORIZED", "DELIVERED"],
        ["DISPUTE", "DELIVERED", "DISPUTED"],
      ],
    );
    const db = openDb(url);
    const events = db
      .prepare("SELECT event, note FROM order_events WHERE order_id = ? ORDER BY seq")
      .all(id) as { event: string; note: string | null }[];
    assert.deepEqual(events.slice(-2).map((e) => e.event), ["DELIVER", "DISPUTE"]);
    assert.ok(events[events.length - 1].note?.startsWith(AUDIT_NOTE_PREFIX));
    const audit = db
      .prepare("SELECT verdict, blocking FROM delivery_audits WHERE order_id = ?")
      .get(id) as { verdict: string; blocking: number };
    assert.deepEqual({ ...audit }, { verdict: "fail", blocking: 1 });
    db.close();
  }),
);

test(
  "service: the clean listing ends DELIVERED and the flawed one is disputed",
  withDbEnv(async ({ url }) => {
    const clean = await advanceEscrowOrder(
      { orderId: seedAuthorized(url, CLEAN), action: "deliver" },
      recorder().deps,
    );
    assert.equal(clean.escrowState, "DELIVERED");
    assert.deepEqual(clean.audit, { verdict: "pass", blocking: false });
    const flawed = await advanceEscrowOrder(
      { orderId: seedAuthorized(url, FLAWED), action: "deliver" },
      recorder().deps,
    );
    assert.equal(flawed.escrowState, "DISPUTED");
  }),
);

test(
  "service: a listing with no fixture delivers exactly as before",
  withDbEnv(async ({ url }) => {
    const id = seedAuthorized(url, CARDIO);
    const { seen, deps } = recorder();
    const res = await advanceEscrowOrder({ orderId: id, action: "deliver", note: "files sent" }, deps);
    assert.equal(res.escrowState, "DELIVERED");
    assert.deepEqual(res.audit, { verdict: "not_applicable", blocking: false });
    assert.equal(seen.length, 1);
    const db = openDb(url);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS n FROM delivery_audits").get() as { n: number }).n,
      0,
    );
    db.close();
  }),
);

test(
  "service: a failed audit save leaves the order AUTHORIZED and announces nothing",
  withDbEnv(async ({ url }) => {
    const id = seedAuthorized(url, CURATED);
    const raw = openDb(url);
    raw.exec(
      `CREATE TRIGGER no_audit BEFORE INSERT ON delivery_audits BEGIN SELECT RAISE(ABORT, 'nope'); END`,
    );
    raw.close();
    const { seen, deps } = recorder();
    await assert.rejects(
      advanceEscrowOrder({ orderId: id, action: "deliver" }, deps),
    );
    assert.equal(seen.length, 0);
    const db = openDb(url);
    assert.equal(
      (db.prepare("SELECT status FROM orders WHERE id = ?").get(id) as { status: string }).status,
      "AUTHORIZED",
    );
    db.close();
  }),
);
