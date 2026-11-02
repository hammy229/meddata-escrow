import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb, createOrder, advanceOrder } from "../db/client";
import { datasetTrust, vendorTrust, listTrust } from "./load";

function seed() {
  const db = openDb(":memory:");
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "v1",
    "Vendor One",
  );
  db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
    "v2",
    "Vendor Two",
  );
  const ins = db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  );
  ins.run("ds_cardio_synthea_v1", "v1", "Cardio", 4900);
  ins.run("ds_other", "v1", "Other", 1000);
  ins.run("ds_v2", "v2", "V2 set", 1000);
  return db;
}

test("datasetTrust is null for an unknown dataset", () => {
  const db = seed();
  assert.equal(datasetTrust(db, "ds_nope"), null);
});

test("datasetTrust counts only that dataset's orders", () => {
  const db = seed();
  const o = createOrder(db, {
    datasetId: "ds_cardio_synthea_v1",
    buyerEmail: "b@x.com",
    amountCents: 4900,
  });
  advanceOrder(db, o.id, "AUTHORIZE");
  advanceOrder(db, o.id, "DELIVER");
  advanceOrder(db, o.id, "DISPUTE", undefined, "bad data");
  createOrder(db, {
    datasetId: "ds_other",
    buyerEmail: "b@x.com",
    amountCents: 1,
  });
  const t = datasetTrust(db, "ds_cardio_synthea_v1");
  assert.ok(t);
  assert.equal(t.datasetId, "ds_cardio_synthea_v1");
  assert.equal(t.vendorId, "v1");
  assert.match(
    t.trust.factors.find((f) => f.key === "disputeRate")!.reason,
    /1 of 1 order /,
  );
});

test("vendorTrust aggregates across the vendor's datasets only", () => {
  const db = seed();
  createOrder(db, {
    datasetId: "ds_cardio_synthea_v1",
    buyerEmail: "a@x.com",
    amountCents: 1,
  });
  createOrder(db, {
    datasetId: "ds_other",
    buyerEmail: "a@x.com",
    amountCents: 1,
  });
  createOrder(db, {
    datasetId: "ds_v2",
    buyerEmail: "a@x.com",
    amountCents: 1,
  });
  const t = vendorTrust(db, "v1");
  assert.ok(t);
  assert.equal(t.name, "Vendor One");
  assert.match(
    t.trust.factors.find((f) => f.key === "volume")!.reason,
    /^2 orders/,
  );
  assert.equal(vendorTrust(db, "nope"), null);
});

test("listTrust returns every vendor and dataset", () => {
  const db = seed();
  const l = listTrust(db);
  assert.deepEqual(l.vendors.map((v) => v.vendorId).sort(), ["v1", "v2"]);
  assert.equal(l.datasets.length, 3);
  for (const x of [...l.vendors, ...l.datasets])
    assert.ok(x.trust.score >= 0 && x.trust.score <= 100);
});
