// /api/match spec — runs with no network: matchDatasets and the catalog are
// both local. Calls the exported POST with a Web Request, mirroring the
// orders route test style.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { POST } from "./route";
import { openDb } from "../../../lib/db/client";
import { seedDatabase } from "../../../lib/db/seed";

// Prices come from the database, so point the route at a seeded temp file
// (never the dev DB) for the whole file.
const dbPath = join(tmpdir(), `meddata-match-${randomUUID()}.sqlite`);
const savedUrl = process.env.DATABASE_URL;

before(() => {
  process.env.DATABASE_URL = `file:${dbPath}`;
  const db = openDb();
  seedDatabase(db);
  db.close();
});

after(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
  rmSync(dbPath, { force: true });
});

function req(body: unknown) {
  return new Request("http://localhost/api/match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("returns ranked, catalog-enriched matches (200)", async () => {
  const res = await POST(
    req({ description: "cardiology cardiovascular synthetic cohort" }),
  );
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.ok(Array.isArray(json.matches));
  assert.ok(json.matches.length >= 1);

  // Ranked: scores are non-increasing.
  for (let i = 1; i < json.matches.length; i++) {
    assert.ok(json.matches[i - 1].score >= json.matches[i].score);
  }

  // Enriched from the catalog, and the cardiology query ranks cardio first.
  const top = json.matches[0];
  assert.equal(top.datasetId, "ds_cardio_synthea_v1");
  assert.equal(typeof top.title, "string");
  assert.equal(typeof top.priceCents, "number");

  // With the LLM off (default in tests) the keyword ranker is reported.
  assert.equal(json.source, "keyword");
});

test("sampleCheck returns the rules verdict for a catalog dataset (200)", async () => {
  const res = await POST(
    req({ sampleCheck: "ds_diabetes_synthea_v1", description: "HbA1c" }),
  );
  assert.equal(res.status, 200);
  const { sampleCheck } = await res.json();
  assert.equal(sampleCheck.passed, true);
  assert.equal(sampleCheck.source, "rules");
  assert.equal(typeof sampleCheck.score, "number");
  assert.ok(Array.isArray(sampleCheck.findings));
});

test("sampleCheck for an unknown dataset -> 404", async () => {
  const res = await POST(req({ sampleCheck: "ds_nope" }));
  assert.equal(res.status, 404);
  assert.equal(typeof (await res.json()).error, "string");
});

test("sampleCheck that is not a string -> 422", async () => {
  const res = await POST(req({ sampleCheck: 42 }));
  assert.equal(res.status, 422);
});

test("empty description -> 422 with { error }", async () => {
  const res = await POST(req({ description: "   " }));
  assert.equal(res.status, 422);
  const json = await res.json();
  assert.equal(typeof json.error, "string");
});

test("matches report the database price, not the catalog.json price", async () => {
  const db = openDb();
  db.prepare(`UPDATE datasets SET price_cents = ? WHERE id = ?`).run(
    12345,
    "ds_cardio_synthea_v1",
  );
  db.close();

  const res = await POST(req({ description: "cardiology cardiovascular" }));
  const { matches } = await res.json();
  const cardio = matches.find(
    (m: { datasetId: string }) => m.datasetId === "ds_cardio_synthea_v1",
  );
  assert.equal(cardio.priceCents, 12345);
});
