// A hung model call must fall back, not hang the demo. The fake client below
// never resolves and ignores the abort signal, like a stuck socket would.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod/v4";

import { withAgentDb } from "../agent/test-db";
import { runProcurementAgent } from "../agent/run";
import { matchDatasets } from "../ai/matcher";
import {
  DEFAULT_TIMEOUT_MS,
  llmTimeoutMs,
  structured,
  type LlmClient,
} from "./client";
import {
  LlmTimeoutError,
  createRingSink,
  recentTraces,
  setTraceSink,
} from "./trace";

beforeEach(() => setTraceSink(createRingSink(20)));

function hungClient() {
  const seen: { signal?: AbortSignal }[] = [];
  const never = (_params: unknown, options?: { signal?: AbortSignal }) => {
    seen.push({ signal: options?.signal });
    return new Promise(() => {});
  };
  const client = {
    messages: { parse: never, create: never },
  } as unknown as LlmClient;
  return { client, seen };
}

test("timeout comes from LLM_TIMEOUT_MS with a sane default", () => {
  assert.equal(llmTimeoutMs({}), DEFAULT_TIMEOUT_MS);
  assert.ok(DEFAULT_TIMEOUT_MS >= 5_000 && DEFAULT_TIMEOUT_MS <= 120_000);
  assert.equal(llmTimeoutMs({ LLM_TIMEOUT_MS: "2500" }), 2500);
  for (const bad of ["", "abc", "0", "-5", "NaN"]) {
    assert.equal(llmTimeoutMs({ LLM_TIMEOUT_MS: bad }), DEFAULT_TIMEOUT_MS);
  }
});

test("structured rejects with LlmTimeoutError and aborts the request", async () => {
  const { client, seen } = hungClient();
  const started = Date.now();
  await assert.rejects(
    structured({
      operation: "t",
      system: "s",
      prompt: "p",
      schema: z.object({ a: z.number() }),
      client,
      timeoutMs: 40,
    }),
    LlmTimeoutError,
  );
  assert.ok(Date.now() - started < 2000);
  assert.equal(seen[0].signal?.aborted, true);
  const [e] = recentTraces();
  assert.equal(e.outcome, "timeout");
  assert.equal(e.fellBack, true);
});

test("a fast answer is not cut off and leaves no timer behind", async () => {
  const client = {
    messages: {
      parse: async () => ({
        stop_reason: "end_turn",
        parsed_output: { a: 1 },
      }),
    },
  } as unknown as LlmClient;
  const out = await structured({
    system: "s",
    prompt: "p",
    schema: z.object({ a: z.number() }),
    client,
    timeoutMs: 5_000,
  });
  assert.deepEqual(out, { a: 1 });
});

test("the matcher falls back to the offline ranking when the model hangs", async () => {
  const { client } = hungClient();
  const prev = process.env.LLM_TIMEOUT_MS;
  process.env.LLM_TIMEOUT_MS = "40";
  try {
    const out = await matchDatasets("cardiology outcomes", {
      useLlm: true,
      client,
    });
    assert.ok(out.length > 0);
    assert.ok(out.every((m) => m.source === "keyword"));
  } finally {
    if (prev === undefined) delete process.env.LLM_TIMEOUT_MS;
    else process.env.LLM_TIMEOUT_MS = prev;
  }
});

test(
  "the agent falls back to the scripted planner when a turn hangs",
  withAgentDb(async () => {
    const { client } = hungClient();
    const r = await runProcurementAgent(
      { study: "Cardiology outcomes in a synthetic cohort", budgetCents: 5000 },
      { client, useLlm: true, timeoutMs: 40 },
    );
    assert.equal(r.source, "scripted");
    assert.ok(r.steps.length > 0);
    const e = recentTraces().find((t) => t.operation === "agent.turn");
    assert.equal(e?.outcome, "timeout");
    assert.equal(e?.fellBack, true);
  }),
);
