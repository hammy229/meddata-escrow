// The agent loop's model calls are traced too, including the fallback flag.
import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";

import { withAgentDb } from "../agent/test-db";
import { runProcurementAgent } from "../agent/run";
import type { LlmClient } from "./client";
import { createRingSink, recentTraces, setTraceSink } from "./trace";

beforeEach(() => setTraceSink(createRingSink(50)));

function client(replies: unknown[]): LlmClient {
  let i = 0;
  return {
    messages: {
      create: async () => {
        const r = replies[i++];
        if (r instanceof Error) throw r;
        return r;
      },
    },
  } as unknown as LlmClient;
}

const endTurn = {
  stop_reason: "end_turn",
  content: [{ type: "text", text: "nothing to buy" }],
  usage: { input_tokens: 300, output_tokens: 20 },
};

test(
  "a clean agent turn is traced with tokens and no fallback",
  withAgentDb(async () => {
    await runProcurementAgent(
      { study: "cardiology", budgetCents: 5000 },
      { client: client([endTurn]), useLlm: true },
    );
    const [e] = recentTraces();
    assert.equal(e.operation, "agent.turn");
    assert.equal(e.outcome, "ok");
    assert.equal(e.fellBack, false);
    assert.equal(e.inputTokens, 300);
    assert.equal(e.outputTokens, 20);
  }),
);

test(
  "a failed agent turn is traced as a fallback to the scripted planner",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: "cardiology", budgetCents: 5000 },
      { client: client([new Error("bedrock down")]), useLlm: true },
    );
    assert.equal(r.source, "scripted");
    const [e] = recentTraces();
    assert.equal(e.outcome, "error");
    assert.equal(e.fellBack, true);
  }),
);

test(
  "a refusal is traced as a refusal",
  withAgentDb(async () => {
    await runProcurementAgent(
      { study: "cardiology", budgetCents: 5000 },
      {
        client: client([{ stop_reason: "refusal", content: [], usage: {} }]),
        useLlm: true,
      },
    );
    assert.equal(recentTraces()[0].outcome, "refusal");
  }),
);
