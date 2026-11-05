// Call tracing spec — no network. Fake clients stand in for Bedrock.
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod/v4";

import { structured, type LlmClient } from "./client";
import {
  createRingSink,
  jsonLineSink,
  promptVersion,
  recentTraces,
  setTraceSink,
  summarizeTraces,
  type TraceEvent,
} from "./trace";

const Answer = z.object({ answer: z.number() });

function parseClient(reply: unknown | Error): LlmClient {
  return {
    messages: {
      parse: async () => {
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  } as unknown as LlmClient;
}

const okReply = {
  stop_reason: "end_turn",
  parsed_output: { answer: 4 },
  usage: { input_tokens: 120, output_tokens: 7 },
};

beforeEach(() => setTraceSink(createRingSink(50)));
afterEach(() => setTraceSink(createRingSink(50)));

test("structured records operation, model, prompt version, tokens, outcome", async () => {
  await structured({
    operation: "match.rank",
    system: "You rank datasets.",
    prompt: "p",
    schema: Answer,
    client: parseClient(okReply),
  });
  const [e] = recentTraces();
  assert.equal(e.operation, "match.rank");
  assert.equal(e.outcome, "ok");
  assert.equal(e.fellBack, false);
  assert.equal(e.inputTokens, 120);
  assert.equal(e.outputTokens, 7);
  assert.equal(e.promptVersion, promptVersion("You rank datasets."));
  assert.match(e.promptVersion, /^[0-9a-f]{8}$/);
  assert.ok(e.model.length > 0);
  assert.ok(Number.isFinite(e.latencyMs) && e.latencyMs >= 0);
});

test("a different system prompt gets a different version", () => {
  assert.notEqual(promptVersion("a"), promptVersion("b"));
  assert.equal(promptVersion("a"), promptVersion("a"));
});

test("calls without an operation still work and are labelled", async () => {
  await structured({
    system: "s",
    prompt: "p",
    schema: Answer,
    client: parseClient(okReply),
  });
  assert.equal(recentTraces()[0].operation, "unspecified");
});

test("each failure mode gets its own outcome and counts as a fallback", async () => {
  const cases: [unknown, TraceEvent["outcome"]][] = [
    [{ stop_reason: "refusal", parsed_output: null }, "refusal"],
    [{ stop_reason: "max_tokens", parsed_output: null }, "truncated"],
    [{ stop_reason: "end_turn", parsed_output: null }, "no_output"],
    [new Error("boom"), "error"],
  ];
  for (const [reply, outcome] of cases) {
    setTraceSink(createRingSink(5));
    await assert.rejects(
      structured({
        operation: "t",
        system: "s",
        prompt: "p",
        schema: Answer,
        client: parseClient(reply),
      }),
    );
    const [e] = recentTraces();
    assert.equal(e.outcome, outcome);
    assert.equal(e.fellBack, true);
  }
});

test("missing usage is null, not a crash", async () => {
  await structured({
    system: "s",
    prompt: "p",
    schema: Answer,
    client: parseClient({
      stop_reason: "end_turn",
      parsed_output: { answer: 1 },
    }),
  });
  const [e] = recentTraces();
  assert.equal(e.inputTokens, null);
  assert.equal(e.outputTokens, null);
});

test("traces never contain prompts, study text, row data or error text", async () => {
  const SECRET_PROMPT = "PATIENT-ZERO-STUDY-TEXT 123-45-6789";
  const SECRET_SYSTEM = "SYSTEM-PROMPT-SECRET";
  const SECRET_ERR = "row data leaked: jane.doe@example.com";
  const lines: string[] = [];
  setTraceSink(jsonLineSink((l) => lines.push(l)));
  await structured({
    operation: "t",
    system: SECRET_SYSTEM,
    prompt: SECRET_PROMPT,
    schema: Answer,
    client: parseClient(okReply),
  });
  await assert.rejects(
    structured({
      operation: "t",
      system: SECRET_SYSTEM,
      prompt: SECRET_PROMPT,
      schema: Answer,
      client: parseClient(new Error(SECRET_ERR)),
    }),
  );
  setTraceSink(createRingSink(5));
  assert.equal(lines.length, 2);
  for (const l of lines) {
    assert.doesNotMatch(
      l,
      /PATIENT-ZERO|6789|SYSTEM-PROMPT|jane\.doe|row data/,
    );
    assert.equal(l.includes("\n"), false);
    JSON.parse(l); // exactly one JSON object per line
  }
});

test("the ring buffer is bounded and keeps the newest events", async () => {
  setTraceSink(createRingSink(3));
  for (let i = 0; i < 10; i++) {
    await structured({
      operation: `op${i}`,
      system: "s",
      prompt: "p",
      schema: Answer,
      client: parseClient(okReply),
    });
  }
  assert.deepEqual(
    recentTraces().map((e) => e.operation),
    ["op7", "op8", "op9"],
  );
});

test("a throwing sink never breaks the model call", async () => {
  setTraceSink({
    record() {
      throw new Error("disk full");
    },
    recent: () => [],
  });
  const out = await structured({
    system: "s",
    prompt: "p",
    schema: Answer,
    client: parseClient(okReply),
  });
  assert.deepEqual(out, { answer: 4 });
});

test("summarizeTraces groups by operation with outcome counts and p50/p95", () => {
  const mk = (
    operation: string,
    latencyMs: number,
    outcome: TraceEvent["outcome"],
    fellBack = false,
  ): TraceEvent => ({
    at: "2026-01-01T00:00:00.000Z",
    operation,
    model: "m",
    promptVersion: "00000000",
    latencyMs,
    inputTokens: 10,
    outputTokens: 5,
    outcome,
    fellBack,
  });
  const s = summarizeTraces([
    mk("a", 100, "ok"),
    mk("a", 200, "ok"),
    mk("a", 300, "error", true),
    mk("b", 50, "timeout", true),
  ]);
  assert.equal(s.a.calls, 3);
  assert.equal(s.a.outcomes.ok, 2);
  assert.equal(s.a.outcomes.error, 1);
  assert.equal(s.a.fallbacks, 1);
  assert.equal(s.a.p50LatencyMs, 200);
  assert.equal(s.a.p95LatencyMs, 300);
  assert.equal(s.a.inputTokens, 30);
  assert.equal(s.b.outcomes.timeout, 1);
});
