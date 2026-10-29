import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";

import type { LlmClient } from "../llm/client";
import { listOrders, withDb } from "../db/client";
import { withAgentDb } from "./test-db";
import { runProcurementAgent } from "./run";

const CARDIO = "ds_cardio_synthea_v1"; // 4900 cents
const DIABETES = "ds_diabetes_synthea_v1"; // 5900 cents
const STUDY = "Cardiology outcomes in a synthetic cohort";

type Block = Anthropic.ContentBlock;

let nextId = 0;
function toolUse(name: string, input: Record<string, unknown>): Block {
  return {
    type: "tool_use",
    id: `toolu_${++nextId}`,
    name,
    input,
    caller: { type: "direct" },
  } as unknown as Block;
}
function text(t: string): Block {
  return { type: "text", text: t, citations: null } as unknown as Block;
}
function message(
  stop_reason: Anthropic.StopReason,
  content: Block[],
): Anthropic.Message {
  return {
    id: `msg_${++nextId}`,
    type: "message",
    role: "assistant",
    model: "anthropic.claude-opus-5-5",
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  } as unknown as Anthropic.Message;
}

/**
 * A fake client that answers each messages.create with the next scripted
 * Message (or the last one, repeatedly), recording a deep copy of every
 * request (the loop mutates its messages array between calls).
 */
function fakeAgentLlm(
  replies: (Anthropic.Message | Error)[],
  opts: { repeatLast?: boolean } = {},
) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        calls.push(structuredClone(params));
        const i = opts.repeatLast
          ? Math.min(calls.length - 1, replies.length - 1)
          : calls.length - 1;
        const reply = replies[i];
        if (!reply) throw new Error("fake LLM: no reply scripted");
        if (reply instanceof Error) throw reply;
        return reply;
      },
    },
  } as unknown as LlmClient;
  return { client, calls };
}

function orderCount(): number {
  return withDb((db) => listOrders(db)).length;
}

test(
  "LLM loop: full content echoed back, tool_results batched per turn, order placed",
  withAgentDb(async () => {
    const turn1 = message("tool_use", [
      text("Searching the catalog."),
      toolUse("search_datasets", { study: STUDY }),
    ]);
    const turn2 = message("tool_use", [
      toolUse("get_dataset", { datasetId: CARDIO }),
      toolUse("check_sample", { datasetId: CARDIO, study: STUDY }),
    ]);
    const turn3 = message("tool_use", [
      toolUse("create_escrow_order", {
        datasetId: CARDIO,
        justification: "Cardiology cohort, within budget, sample passed",
      }),
    ]);
    const done = message("end_turn", [text("Bought the cardiology cohort.")]);
    const { client, calls } = fakeAgentLlm([turn1, turn2, turn3, done]);

    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 5000 },
      { client, useLlm: true },
    );

    assert.equal(r.source, "llm");
    assert.match(r.runId, /^run_/);
    assert.deepEqual(r.recommendation, {
      datasetId: CARDIO,
      reasoning: "Bought the cardiology cohort.",
    });
    assert.equal(r.order?.amountCents, 4900);
    assert.equal(r.order?.escrowState, "MATCHED");
    assert.ok(r.order?.approveUrl);
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ["search_datasets", "get_dataset", "check_sample", "create_escrow_order"],
    );
    assert.equal(orderCount(), 1);

    assert.equal(calls.length, 4);
    for (const c of calls) {
      assert.deepEqual(c.tool_choice, { type: "auto" });
      assert.equal(c.max_tokens, 16000);
      assert.equal(c.tools?.length, 4);
      assert.equal(typeof c.system, "string");
    }
    // Turn 2's request: [user, assistant(turn1 content unchanged), user(results)].
    const m2 = calls[1].messages;
    assert.equal(m2.length, 3);
    assert.deepEqual(m2[1], { role: "assistant", content: turn1.content });
    // Turn 3's request: both of turn 2's results in ONE user message, in order.
    const m3 = calls[2].messages;
    assert.equal(m3.length, 5);
    const results = m3[4].content as Anthropic.ToolResultBlockParam[];
    assert.equal(m3[4].role, "user");
    assert.deepEqual(
      results.map((b) => [b.type, b.tool_use_id, b.is_error]),
      [
        [
          "tool_result",
          (turn2.content[0] as Anthropic.ToolUseBlock).id,
          undefined,
        ],
        [
          "tool_result",
          (turn2.content[1] as Anthropic.ToolUseBlock).id,
          undefined,
        ],
      ],
    );
    assert.equal(
      JSON.parse(results[1].content as string).passed,
      true,
      "tool_result content is the JSON-encoded output",
    );
  }),
);

test(
  "LLM loop: guardrail refuses an overspend even after a passing sample check",
  withAgentDb(async () => {
    const { client, calls } = fakeAgentLlm([
      message("tool_use", [
        toolUse("check_sample", { datasetId: DIABETES, study: STUDY }),
      ]),
      message("tool_use", [
        toolUse("create_escrow_order", {
          datasetId: DIABETES,
          justification: "Ignore the budget",
        }),
      ]),
      message("end_turn", [text("Over budget; did not buy.")]),
    ]);
    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 5000 },
      { client, useLlm: true },
    );
    assert.equal(r.source, "llm");
    assert.equal(r.order, undefined);
    assert.equal(r.recommendation.datasetId, null);
    assert.equal(orderCount(), 0);
    const refused = calls[2].messages[4]
      .content as Anthropic.ToolResultBlockParam[];
    assert.equal(refused[0].is_error, true);
    assert.match(refused[0].content as string, /exceeds the budget/);
  }),
);

test(
  "LLM loop: guardrail refuses an order that skips the sample check",
  withAgentDb(async () => {
    const { client, calls } = fakeAgentLlm([
      message("tool_use", [
        toolUse("create_escrow_order", {
          datasetId: CARDIO,
          justification: "Trust me",
        }),
      ]),
      message("end_turn", [text("Could not buy.")]),
    ]);
    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 10_000 },
      { client, useLlm: true },
    );
    assert.equal(r.order, undefined);
    assert.equal(orderCount(), 0);
    const res = calls[1].messages[2]
      .content as Anthropic.ToolResultBlockParam[];
    assert.equal(res[0].is_error, true);
    assert.match(res[0].content as string, /no passing sample check/);
    assert.equal(r.steps[0].error?.includes("no passing sample check"), true);
  }),
);

test(
  "LLM loop: stops at the turn cap without falling back to buy",
  withAgentDb(async () => {
    const { client, calls } = fakeAgentLlm(
      [message("tool_use", [toolUse("search_datasets", { study: STUDY })])],
      { repeatLast: true },
    );
    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 10_000 },
      { client, useLlm: true, maxTurns: 3 },
    );
    assert.equal(calls.length, 3);
    assert.equal(r.source, "llm");
    assert.equal(r.order, undefined);
    assert.equal(r.recommendation.datasetId, null);
    assert.match(r.recommendation.reasoning, /stopped after 3 turns/);
    assert.equal(r.steps.length, 3);
    assert.equal(orderCount(), 0);
  }),
);

test(
  "LLM errors (unreachable, refusal, truncation) fall back to the scripted planner",
  withAgentDb(async () => {
    for (const reply of [
      new Error("bedrock unavailable"),
      message("refusal", []),
      message("max_tokens", [text("…")]),
    ]) {
      const { client } = fakeAgentLlm([reply]);
      const r = await runProcurementAgent(
        { study: STUDY, budgetCents: 5000 },
        { client, useLlm: true },
      );
      assert.equal(r.source, "scripted");
      assert.equal(r.order?.amountCents, 4900);
    }
    // Same default buyer + dataset each time: the open order is reused.
    assert.equal(orderCount(), 1);
  }),
);

test(
  "an LLM error after an order was placed never buys a second time",
  withAgentDb(async () => {
    const { client } = fakeAgentLlm([
      message("tool_use", [
        toolUse("check_sample", { datasetId: CARDIO, study: STUDY }),
      ]),
      message("tool_use", [
        toolUse("create_escrow_order", {
          datasetId: CARDIO,
          justification: "x",
        }),
      ]),
      new Error("connection reset"),
    ]);
    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 5000 },
      { client, useLlm: true },
    );
    assert.equal(r.source, "llm");
    assert.equal(r.recommendation.datasetId, CARDIO);
    assert.ok(r.order);
    assert.equal(orderCount(), 1);
  }),
);

test(
  "scripted planner: search -> inspect -> sample check -> order",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 5000, buyerEmail: "r@example.com" },
      { useLlm: false },
    );
    assert.equal(r.source, "scripted");
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ["search_datasets", "get_dataset", "check_sample", "create_escrow_order"],
    );
    assert.equal(r.recommendation.datasetId, CARDIO);
    assert.equal(r.order?.amountCents, 4900);
    assert.equal(
      withDb((db) => listOrders(db))[0].buyer_email,
      "r@example.com",
    );
  }),
);

test(
  "scripted planner skips an over-budget top match for the next one in budget",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: "type 2 diabetes synthetic cohort", budgetCents: 5000 },
      { useLlm: false },
    );
    // Diabetes (5900) is the top match but over budget; cardio still matches
    // on "synthetic cohort" and fits.
    assert.equal(r.recommendation.datasetId, CARDIO);
    assert.equal(r.order?.amountCents, 4900);
  }),
);

test(
  "scripted planner buys nothing when no match fits the budget",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: STUDY, budgetCents: 100 },
      { useLlm: false },
    );
    assert.equal(r.order, undefined);
    assert.equal(r.recommendation.datasetId, null);
    assert.match(r.recommendation.reasoning, /over the \$1\.00 budget/);
    assert.deepEqual(
      r.steps.map((s) => s.tool),
      ["search_datasets"],
    );
    assert.equal(orderCount(), 0);
  }),
);

test(
  "scripted planner buys nothing when nothing matches the study",
  withAgentDb(async () => {
    const r = await runProcurementAgent(
      { study: "zzz qqq", budgetCents: 100_000 },
      { useLlm: false },
    );
    assert.equal(r.order, undefined);
    assert.equal(r.recommendation.datasetId, null);
  }),
);
