import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { randomUUID } from "node:crypto";

import { assignAlsListings, parseArgs } from "./assign-als-listings";
import { openDb } from "../../lib/db/client";
import { sqliteConnection } from "../../lib/db/connection";
import { seedDatabase } from "../../lib/db/seed";

function withDb(fn: (raw: ReturnType<typeof openDb>) => Promise<void>) {
  return async () => {
    const path = join(tmpdir(), `meddata-assign-${randomUUID()}.sqlite`);
    const raw = openDb(`file:${path}`);
    seedDatabase(raw);
    try {
      await fn(raw);
    } finally {
      raw.close();
      rmSync(path, { force: true });
    }
  };
}

function addAccount(
  raw: ReturnType<typeof openDb>,
  over: { role?: string; vendorId?: string | null; email?: string } = {},
) {
  const id = randomUUID();
  const vendorId = over.vendorId === undefined ? `vnd_${id}` : over.vendorId;
  if (vendorId)
    raw
      .prepare("INSERT INTO vendors (id, name) VALUES (?, ?)")
      .run(vendorId, "Test Vendor");
  raw
    .prepare(
      "INSERT INTO accounts (id, email, name, role, password_hash, vendor_id) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      over.email ?? "v@example.com",
      "V",
      over.role ?? "vendor",
      "x",
      vendorId,
    );
  return { id, vendorId };
}

const ownerOf = (raw: ReturnType<typeof openDb>, id: string) =>
  (
    raw.prepare("SELECT vendor_id FROM datasets WHERE id = ?").get(id) as {
      vendor_id: string;
    }
  ).vendor_id;

test(
  "assigns the ALS listings to the vendor account and leaves the rest alone",
  withDb(async (raw) => {
    const acct = addAccount(raw);
    const before = ownerOf(raw, "ds_cardio_synthea_v1");
    const out = await assignAlsListings(sqliteConnection(raw), "V@Example.com");
    assert.equal(out.vendorId, acct.vendorId);
    assert.deepEqual(out.datasetIds.sort(), [
      "ds_als_survival_axonpoint_v1",
      "ds_als_survival_curated_v1",
      "ds_als_survival_motorneuron_v1",
    ]);
    for (const id of out.datasetIds)
      assert.equal(ownerOf(raw, id), acct.vendorId);
    assert.equal(ownerOf(raw, "ds_cardio_synthea_v1"), before);
    // Running it again changes nothing and still succeeds.
    const again = await assignAlsListings(
      sqliteConnection(raw),
      "v@example.com",
    );
    assert.deepEqual(again.datasetIds.sort(), out.datasetIds.sort());
  }),
);

test(
  "refuses an unknown account, a researcher and a vendor who has not finished setup",
  withDb(async (raw) => {
    const db = sqliteConnection(raw);
    const owner = ownerOf(raw, "ds_als_survival_curated_v1");
    await assert.rejects(
      () => assignAlsListings(db, "nobody@example.com"),
      /No account/,
    );
    addAccount(raw, {
      role: "researcher",
      email: "r@example.com",
      vendorId: null,
    });
    await assert.rejects(
      () => assignAlsListings(db, "r@example.com"),
      /not a vendor/,
    );
    addAccount(raw, { email: "new@example.com", vendorId: null });
    await assert.rejects(
      () => assignAlsListings(db, "new@example.com"),
      /setup/,
    );
    assert.equal(ownerOf(raw, "ds_als_survival_curated_v1"), owner);
  }),
);

test("parseArgs reads --email and rejects anything else", () => {
  assert.deepEqual(parseArgs(["--email", "a@b.co"]), { email: "a@b.co" });
  assert.equal(parseArgs([]).error !== undefined, true);
  assert.equal(parseArgs(["--email"]).error !== undefined, true);
  assert.equal(parseArgs(["--wat", "x"]).error !== undefined, true);
});
