// /api/insights spec: aggregate marketplace figures from an isolated DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { openDb } from "../../../lib/db/client";
import { seedDemoStory } from "../../../lib/db/demo-story";
import { seedDatabase } from "../../../lib/db/seed";
import { GET } from "./handlers";

async function withDb(story: boolean, fn: () => Promise<void>): Promise<void> {
  const path = join(tmpdir(), `meddata-insights-${randomUUID()}.sqlite`);
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = `file:${path}`;
  const db = openDb(`file:${path}`);
  seedDatabase(db);
  if (story) seedDemoStory(db);
  db.close();
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    rmSync(path, { force: true });
  }
}

test("GET on an empty book is 200 with zeroed figures", async () => {
  await withDb(false, async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const { insights } = await res.json();
    assert.equal(insights.orderCount, 0);
    assert.equal(insights.gmvCents, 0);
    assert.equal(insights.avgTimeToDeliverHours, null);
    assert.deepEqual(insights.topDatasets, []);
  });
});

test("GET with the demo story reports held and released money", async () => {
  await withDb(true, async () => {
    const res = await GET();
    assert.equal(res.status, 200);
    const { insights } = await res.json();
    assert.equal(insights.orderCount, 6);
    assert.ok(insights.heldCents > 0);
    assert.ok(insights.releasedCents > 0);
    assert.ok(insights.byVendor.length > 0);
  });
});

test("GET is 500 with a generic error when the database cannot open", async () => {
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "file:/nonexistent-dir/x/y.sqlite";
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await GET();
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "internal error" });
  } finally {
    console.error = orig;
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});
