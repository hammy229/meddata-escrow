// /api/health spec — the uptime probe. Points DATABASE_URL at an isolated temp
// SQLite file (ok case) or an unopenable path (error case) and checks the
// response never leaks configuration.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { GET } from "./route";

async function withEnv(
  env: { DATABASE_URL: string; PAYPAL_MODE?: string },
  fn: () => Promise<void>,
) {
  const saved = {
    url: process.env.DATABASE_URL,
    mode: process.env.PAYPAL_MODE,
  };
  process.env.DATABASE_URL = env.DATABASE_URL;
  if (env.PAYPAL_MODE === undefined) delete process.env.PAYPAL_MODE;
  else process.env.PAYPAL_MODE = env.PAYPAL_MODE;
  try {
    await fn();
  } finally {
    const restore = (k: string, v: string | undefined) =>
      v === undefined ? delete process.env[k] : (process.env[k] = v);
    restore("DATABASE_URL", saved.url);
    restore("PAYPAL_MODE", saved.mode);
  }
}

test("GET is 200 ok with db ok, reporting live mode by default", async () => {
  const path = join(tmpdir(), `meddata-health-${randomUUID()}.sqlite`);
  try {
    await withEnv({ DATABASE_URL: path }, async () => {
      const res = await GET();
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        status: "ok",
        mode: "live",
        db: "ok",
      });
    });
  } finally {
    rmSync(path, { force: true });
  }
});

test("GET reports mock mode when PAYPAL_MODE=mock", async () => {
  const path = join(tmpdir(), `meddata-health-${randomUUID()}.sqlite`);
  try {
    await withEnv({ DATABASE_URL: path, PAYPAL_MODE: "mock" }, async () => {
      const json = await (await GET()).json();
      assert.equal(json.mode, "mock");
      assert.equal(json.status, "ok");
    });
  } finally {
    rmSync(path, { force: true });
  }
});

test("GET is 503 when the DB cannot be opened, without leaking details", async (t) => {
  t.mock.method(console, "error", () => {}); // keep the expected log quiet
  const badPath = join(tmpdir(), `no-such-dir-${randomUUID()}`, "db.sqlite");
  await withEnv({ DATABASE_URL: `file:${badPath}` }, async () => {
    const res = await GET();
    assert.equal(res.status, 503);
    const json = await res.json();
    assert.deepEqual(json, { status: "error", mode: "live", db: "error" });
    assert.ok(!JSON.stringify(json).includes(badPath));
  });
});
