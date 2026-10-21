// LLM seam spec — no network: a fake client stands in for Bedrock.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as z from "zod/v4";

import {
  DEFAULT_MODEL,
  llmEnabled,
  llmModel,
  structured,
  type LlmClient,
} from "./client";

function fakeClient(reply: Record<string, unknown>) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        return reply;
      },
    },
  } as unknown as LlmClient;
  return { client, calls };
}

const Answer = z.object({ answer: z.number() });

test("LLM is opt-in: only LLM_PROVIDER=bedrock enables it", () => {
  assert.equal(llmEnabled({}), false);
  assert.equal(llmEnabled({ LLM_PROVIDER: "mock" }), false);
  assert.equal(llmEnabled({ LLM_PROVIDER: "bedrock" }), true);
});

test("model defaults to Claude Opus 5.5 on Bedrock and is overridable", () => {
  assert.equal(llmModel({}), DEFAULT_MODEL);
  assert.equal(llmModel({ LLM_MODEL: "x" }), "x");
});

test("structured returns the parsed output and sends a schema format", async () => {
  const { client, calls } = fakeClient({
    stop_reason: "end_turn",
    parsed_output: { answer: 4 },
  });
  const out = await structured({
    system: "s",
    prompt: "2+2",
    schema: Answer,
    client,
  });
  assert.deepEqual(out, { answer: 4 });
  const params = calls[0] as { output_config: { format: unknown } };
  assert.ok(params.output_config.format);
});

test("structured throws on refusal, truncation, or no parse", async () => {
  for (const reply of [
    { stop_reason: "refusal", parsed_output: null },
    { stop_reason: "max_tokens", parsed_output: null },
    { stop_reason: "end_turn", parsed_output: null },
  ]) {
    const { client } = fakeClient(reply);
    await assert.rejects(
      structured({ system: "s", prompt: "p", schema: Answer, client }),
    );
  }
});
