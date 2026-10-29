// Dataset listing helpers against an in-memory DB seeded from the catalog.
import { test } from "node:test";
import assert from "node:assert/strict";

import { openDb } from "./client";
import { listDatasets, priceMap, updateDatasetPrice } from "./datasets";
import { seedDatabase } from "./seed";

function seededDb() {
  const db = openDb(":memory:");
  seedDatabase(db);
  return db;
}

test("listDatasets returns every seeded listing with catalog metadata", () => {
  const db = seededDb();
  const all = listDatasets(db);
  assert.ok(all.length >= 1);
  const cardio = all.find((d) => d.id === "ds_cardio_synthea_v1");
  assert.ok(cardio);
  assert.equal(cardio.priceCents, 4900);
  assert.equal(cardio.vendorId, "vnd_demo_health");
  assert.equal(cardio.recordCount, 10000);
  assert.ok(cardio.tags.includes("cardiology"));
});

test("a dataset missing from catalog.json still lists, without metadata", () => {
  const db = seededDb();
  db.prepare(
    `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
  ).run("ds_extra", "vnd_demo_health", "Extra", 500);
  const extra = listDatasets(db).find((d) => d.id === "ds_extra");
  assert.deepEqual(extra, {
    id: "ds_extra",
    vendorId: "vnd_demo_health",
    title: "Extra",
    description: null,
    priceCents: 500,
    recordCount: null,
    tags: [],
  });
});

test("updateDatasetPrice persists the new price and returns the listing", () => {
  const db = seededDb();
  const updated = updateDatasetPrice(db, "ds_cardio_synthea_v1", 6000);
  assert.equal(updated?.priceCents, 6000);
  assert.equal(priceMap(db).get("ds_cardio_synthea_v1"), 6000);
  const other = listDatasets(db).find((d) => d.id !== "ds_cardio_synthea_v1");
  assert.ok(other && other.priceCents !== 6000);
});

test("updateDatasetPrice returns undefined for an unknown dataset", () => {
  const db = seededDb();
  assert.equal(updateDatasetPrice(db, "ds_nope", 6000), undefined);
});
