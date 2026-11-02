// Guided demo spec. The story runs against the REAL route handlers (an
// in-process fetch that dispatches to them) over an isolated temp database in
// mock mode, so these tests prove the walkthrough uses no fake data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";

import { openDb } from "../../lib/db/client";
import { seedDatabase } from "../../lib/db/seed";
import * as reset from "../api/demo/reset/route";
import * as match from "../api/match/route";
import * as orders from "../api/orders/route";
import * as query from "../api/query/route";
import {
  STEPS,
  StoryError,
  runStep,
  type Fetcher,
  type StoryCtx,
} from "./story";

type Handlers = Record<string, (req: Request) => Promise<Response>>;
const routes: Record<string, Handlers> = {
  "/api/demo/reset": reset as unknown as Handlers,
  "/api/match": match as unknown as Handlers,
  "/api/orders": orders as unknown as Handlers,
  "/api/query": query as unknown as Handlers,
};

const inProcessFetch: Fetcher = async (url, init) => {
  const u = new URL(url, "http://localhost");
  const handler = routes[u.pathname]?.[(init?.method ?? "GET").toUpperCase()];
  if (!handler) return new Response("no route", { status: 404 });
  return handler(new Request(u, init));
};

async function withMockDb(
  mode: string | undefined,
  fn: () => Promise<void>,
): Promise<void> {
  const path = join(tmpdir(), `meddata-story-${randomUUID()}.sqlite`);
  const keys = ["DATABASE_URL", "PAYPAL_MODE", "LLM_PROVIDER"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env.DATABASE_URL = `file:${path}`;
  if (mode === undefined) delete process.env.PAYPAL_MODE;
  else process.env.PAYPAL_MODE = mode;
  delete process.env.LLM_PROVIDER;
  const db = openDb(`file:${path}`);
  seedDatabase(db);
  db.close();
  try {
    await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(path, { force: true });
  }
}

const ctx0: StoryCtx = {};

test("the story has the seven narrated steps in order", () => {
  assert.deepEqual(
    STEPS.map((s) => s.id),
    ["reset", "match", "sample", "hold", "deliver", "query", "release"],
  );
  for (const s of STEPS) {
    assert.ok(s.title && s.caption, `${s.id} has copy`);
    assert.doesNotMatch(s.title + s.caption, /[–—]/, "no dashes");
  }
});

test("the full story plays through the real APIs to a paid-out order", async () => {
  await withMockDb("mock", async () => {
    let ctx = ctx0;
    const seen: Record<string, string[]> = {};
    for (const step of STEPS) {
      const out = await runStep(step.id, ctx, inProcessFetch);
      assert.equal(out.halt, undefined, `${step.id} did not halt`);
      assert.ok(out.facts.length > 0, `${step.id} reports facts`);
      seen[step.id] = out.facts.map((f) => `${f.label}=${f.value}`);
      ctx = out.ctx;
    }
    assert.ok(ctx.orderId?.startsWith("ord_"));
    assert.ok(ctx.datasetId);

    // The order really ended PAID_OUT in the database.
    const res = await inProcessFetch(`/api/orders?id=${ctx.orderId}`);
    const { order } = await res.json();
    assert.equal(order.status, "PAID_OUT");

    // The hold step reported the held state, the release step the split.
    assert.ok(seen.hold.some((f) => f === "State=AUTHORIZED"));
    assert.ok(seen.deliver.some((f) => f === "State=DELIVERED"));
    assert.ok(seen.release.some((f) => f === "State=PAID_OUT"));
    const total = seen.release.find((f) => f.startsWith("Total charged="));
    assert.ok(total, "release shows the total");
  });
});

test("reset seeds the story orders before the walkthrough starts", async () => {
  await withMockDb("mock", async () => {
    const out = await runStep("reset", ctx0, inProcessFetch);
    assert.match(out.facts.map((f) => f.value).join(" "), /6/);
    const { orders: rows } = await (await inProcessFetch("/api/orders")).json();
    assert.equal(rows.length, 6);
  });
});

test("outside mock mode the reset step fails with a clear message", async () => {
  await withMockDb(undefined, async () => {
    await assert.rejects(
      () => runStep("reset", ctx0, inProcessFetch),
      (err: unknown) =>
        err instanceof StoryError && /PAYPAL_MODE=mock/.test(err.message),
    );
  });
});

test("steps refuse to run out of order instead of faking context", async () => {
  await assert.rejects(
    () => runStep("hold", ctx0, inProcessFetch),
    (err: unknown) => err instanceof StoryError,
  );
  await assert.rejects(
    () => runStep("release", { datasetId: "x" }, inProcessFetch),
    (err: unknown) => err instanceof StoryError,
  );
});

test("a failing sample check halts the story and moves no money", async () => {
  await withMockDb("mock", async () => {
    const failing: Fetcher = async (url, init) => {
      if (url === "/api/match" && String(init?.body).includes("sampleCheck"))
        return Response.json({
          sampleCheck: {
            passed: false,
            score: 41,
            findings: ["Too many duplicate rows."],
            source: "rules",
          },
        });
      return inProcessFetch(url, init);
    };
    let ctx = (await runStep("match", ctx0, failing)).ctx;
    const out = await runStep("sample", ctx, failing);
    assert.ok(out.halt, "halts");
    assert.match(out.halt!, /no money moved/i);
    ctx = out.ctx;
    const { orders: rows } = await (await inProcessFetch("/api/orders")).json();
    assert.equal(rows.length, 0);
  });
});

test("an API error surfaces its message as a StoryError", async () => {
  const broken: Fetcher = async () =>
    Response.json({ error: "internal error" }, { status: 500 });
  await assert.rejects(
    () => runStep("match", ctx0, broken),
    (err: unknown) =>
      err instanceof StoryError && /internal error/.test(err.message),
  );
});

test("an unreachable server surfaces as a StoryError", async () => {
  const down: Fetcher = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(
    () => runStep("match", ctx0, down),
    (err: unknown) => err instanceof StoryError,
  );
});

test("a rejected question explains why instead of faking an answer", async () => {
  await withMockDb("mock", async () => {
    let ctx = ctx0;
    for (const id of ["reset", "match", "sample", "hold", "deliver"] as const)
      ctx = (await runStep(id, ctx, inProcessFetch)).ctx;
    const blocked: Fetcher = async (url, init) =>
      url === "/api/query"
        ? Response.json(
            { error: "query rejected", reasons: ["row-level request"] },
            { status: 403 },
          )
        : inProcessFetch(url, init);
    await assert.rejects(
      () => runStep("query", ctx, blocked),
      (err: unknown) =>
        err instanceof StoryError && /row-level request/.test(err.message),
    );
  });
});
