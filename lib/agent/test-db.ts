// Test-only: run a body against an isolated temp-file SQLite DB seeded with
// data/catalog.json, in PAYPAL_MODE=mock with the LLM off. A temp file (not
// :memory:) because withDb opens a fresh connection per call. Env is restored
// afterwards.
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { openDb } from "../db/client";

interface SeedEntry {
  id: string;
  vendorId: string;
  title: string;
  priceCents: number;
}

const CATALOG_URL = new URL("../../data/catalog.json", import.meta.url);

export function withAgentDb(
  fn: (ctx: { url: string }) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const path = join(tmpdir(), `meddata-agent-${randomUUID()}.sqlite`);
    const url = `file:${path}`;
    const keys = ["DATABASE_URL", "PAYPAL_MODE", "LLM_PROVIDER"] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    process.env.DATABASE_URL = url;
    process.env.PAYPAL_MODE = "mock";
    delete process.env.LLM_PROVIDER;

    const db = openDb(url);
    const catalog = JSON.parse(
      readFileSync(CATALOG_URL, "utf8"),
    ) as SeedEntry[];
    for (const vendorId of new Set(catalog.map((d) => d.vendorId)))
      db.prepare(`INSERT INTO vendors (id, name) VALUES (?, ?)`).run(
        vendorId,
        vendorId,
      );
    for (const d of catalog)
      db.prepare(
        `INSERT INTO datasets (id, vendor_id, title, price_cents) VALUES (?, ?, ?, ?)`,
      ).run(d.id, d.vendorId, d.title, d.priceCents);
    db.close();

    try {
      await fn({ url });
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      rmSync(path, { force: true });
    }
  };
}
