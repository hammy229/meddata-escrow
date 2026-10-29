// /api/datasets spec. withDb opens a fresh connection per call, so each test
// gets a seeded temp-file DB via DATABASE_URL (never the dev DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { GET, PATCH } from "./route";
import { openDb } from "../../../lib/db/client";
import { seedDatabase } from "../../../lib/db/seed";

const DATASET_ID = "ds_cardio_synthea_v1";

function patch(body: unknown) {
  return new Request("http://localhost/api/datasets", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function withDb(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-datasets-${randomUUID()}.sqlite`);
    const saved = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `file:${path}`;
    const db = openDb();
    seedDatabase(db);
    db.close();
    try {
      await fn();
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved;
      rmSync(path, { force: true });
    }
  };
}

test(
  "GET lists the seeded datasets with prices and metadata",
  withDb(async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const { datasets } = await res.json();
    const cardio = datasets.find((d: { id: string }) => d.id === DATASET_ID);
    assert.equal(cardio.priceCents, 4900);
    assert.equal(typeof cardio.title, "string");
    assert.equal(cardio.recordCount, 10000);
    assert.ok(Array.isArray(cardio.tags));
  }),
);

test(
  "PATCH reprices a dataset and GET reflects it",
  withDb(async () => {
    const res = await PATCH(patch({ datasetId: DATASET_ID, priceCents: 7500 }));
    assert.equal(res.status, 200);
    const { dataset } = await res.json();
    assert.equal(dataset.id, DATASET_ID);
    assert.equal(dataset.priceCents, 7500);

    const list = await (await GET()).json();
    const again = list.datasets.find(
      (d: { id: string }) => d.id === DATASET_ID,
    );
    assert.equal(again.priceCents, 7500);
  }),
);

test(
  "PATCH with a malformed body -> 400 { error }",
  withDb(async () => {
    const bodies: unknown[] = [
      "not json",
      "null",
      [1],
      {},
      { datasetId: "", priceCents: 500 },
      { datasetId: 7, priceCents: 500 },
      { datasetId: DATASET_ID },
      { datasetId: DATASET_ID, priceCents: "500" },
    ];
    for (const body of bodies) {
      const res = await PATCH(patch(body));
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(typeof (await res.json()).error, "string");
    }
  }),
);

test(
  "PATCH for an unknown dataset -> 404",
  withDb(async () => {
    const res = await PATCH(patch({ datasetId: "ds_nope", priceCents: 500 }));
    assert.equal(res.status, 404);
    assert.equal(typeof (await res.json()).error, "string");
  }),
);

test(
  "PATCH with a price outside the rules -> 422 and the price is unchanged",
  withDb(async () => {
    for (const priceCents of [99, 1_000_001, 49.5, -100]) {
      const res = await PATCH(patch({ datasetId: DATASET_ID, priceCents }));
      assert.equal(res.status, 422, String(priceCents));
      assert.equal(typeof (await res.json()).error, "string");
    }
    const list = await (await GET()).json();
    const d = list.datasets.find((x: { id: string }) => x.id === DATASET_ID);
    assert.equal(d.priceCents, 4900);
  }),
);
