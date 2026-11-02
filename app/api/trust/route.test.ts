import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { GET } from "./handlers";
import { openDb } from "../../../lib/db/client";

let url: string;
let prev: string | undefined;

beforeEach(() => {
  prev = process.env.DATABASE_URL;
  url = join(tmpdir(), `trust-${randomUUID()}.sqlite`);
  process.env.DATABASE_URL = url;
  const db = openDb(url);
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "v1",
    "Vendor One",
  );
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_cardio_synthea_v1", "v1", "Cardio", 4900);
  db.close();
});

afterEach(() => {
  if (prev === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = prev;
  rmSync(url, { force: true });
});

const get = (qs = "") => GET(new Request(`http://localhost/api/trust${qs}`));

test("list mode returns vendors and datasets with scores", async () => {
  const res = await get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.vendors.length, 1);
  assert.equal(body.datasets.length, 1);
  assert.equal(typeof body.vendors[0].trust.score, "number");
});

test("?vendorId= returns one vendor's trust", async () => {
  const res = await get("?vendorId=v1");
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.vendorId, "v1");
  assert.equal(body.trust.factors.length, 5);
});

test("?datasetId= returns one dataset's trust", async () => {
  const res = await get("?datasetId=ds_cardio_synthea_v1");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).datasetId, "ds_cardio_synthea_v1");
});

test("unknown ids are 404", async () => {
  assert.equal((await get("?vendorId=zzz")).status, 404);
  assert.equal((await get("?datasetId=zzz")).status, 404);
});

test("passing both vendorId and datasetId is 422", async () => {
  assert.equal((await get("?vendorId=v1&datasetId=x")).status, 422);
});
