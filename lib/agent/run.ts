// The procurement agent: given a study and a budget, find a dataset, inspect
// it, check its sample, and — only if every guardrail in ./tools allows it —
// open a PayPal escrow order the buyer then approves.
//
// Two planners drive the SAME tools (so the same guardrails and audit steps):
//   - "llm": Claude on Bedrock in a manual tool-use loop. tool_choice is
//     "auto" (Opus 5.5 rejects forced tool choice); the system prompt sets the
//     search -> inspect -> sample-check -> order sequence, and the code
//     enforces it regardless.
//   - "scripted": a deterministic planner (top in-budget match -> sample check
//     -> order if passed). Used when the LLM is off, or when the LLM path
//     errors before placing an order, so the demo runs with no AWS.
//
// A run that hits the turn cap simply stops (no fallback): the model chose
// not to buy in time, and the scripted planner must not buy on its behalf.
import type Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";

import {
  getLlmClient,
  llmEnabled,
  llmModel,
  type LlmClient,
} from "../llm/client";
import type { EscrowDeps } from "../escrow/service";
import {
  AGENT_TOOLS,
  createAgentContext,
  executeTool,
  type AgentContext,
  type AgentOrder,
  type AgentStep,
} from "./tools";

export interface AgentRunInput {
  study: string;
  budgetCents: number;
  buyerEmail?: string;
}

export interface AgentRunOptions {
  /** Inject a client (tests). Defaults to the shared Bedrock client. */
  client?: LlmClient;
  /** Force the LLM planner on/off. Defaults to llmEnabled(). */
  useLlm?: boolean;
  /** Max model calls in the LLM loop (default MAX_TURNS). */
  maxTurns?: number;
  escrowDeps?: EscrowDeps;
}

export interface AgentRunResult {
  runId: string;
  steps: AgentStep[];
  recommendation: { datasetId: string | null; reasoning: string };
  order?: AgentOrder;
  source: "llm" | "scripted";
}

export const MAX_TURNS = 8;

const SYSTEM = [
  "You are a procurement agent buying medical research datasets for a researcher.",
  "Work in this order: search_datasets for the study; get_dataset on the best candidate;",
  "check_sample on it; then, only if the sample check passed and the listed price is",
  "within the budget, call create_escrow_order exactly once. Use only dataset ids",
  "returned by the tools; never invent ids or prices. If no dataset fits the study,",
  "the budget, or the sample check, do not buy. The order only opens a PayPal escrow",
  "the researcher must approve; you cannot move money. Finish with a short plain-text",
  "summary: what you bought (or why you did not) and why.",
].join(" ");

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function result(
  runId: string,
  ctx: AgentContext,
  source: AgentRunResult["source"],
  reasoning: string,
  datasetId: string | null = ctx.order?.datasetId ?? null,
): AgentRunResult {
  return {
    runId,
    steps: ctx.steps,
    recommendation: { datasetId, reasoning },
    ...(ctx.order ? { order: ctx.order } : {}),
    source,
  };
}

async function runLlm(
  runId: string,
  ctx: AgentContext,
  client: LlmClient,
  maxTurns: number,
): Promise<AgentRunResult> {
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Study: ${ctx.study}\n` +
        `Budget: ${ctx.budgetCents} cents (${dollars(ctx.budgetCents)}).`,
    },
  ];

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await client.messages.create({
      model: llmModel(),
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      tools: AGENT_TOOLS,
      tool_choice: { type: "auto" },
    });
    if (response.stop_reason === "refusal")
      throw new Error("LLM declined the request");
    if (response.stop_reason === "max_tokens")
      throw new Error("LLM response was truncated");

    // The full content array goes back unchanged (thinking/text/tool_use).
    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      return result(runId, ctx, "llm", text || "Agent finished.");
    }

    const uses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );
    if (uses.length === 0)
      throw new Error("LLM stopped for tool_use without a tool call");

    // Sequential on purpose: the guardrails read state earlier calls set.
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const use of uses) {
      const outcome = await executeTool(ctx, use.name, use.input);
      results.push({
        type: "tool_result",
        tool_use_id: use.id,
        content: JSON.stringify(
          outcome.ok ? outcome.output : { error: outcome.error },
        ),
        ...(outcome.ok ? {} : { is_error: true }),
      });
    }
    messages.push({ role: "user", content: results });
  }

  return result(
    runId,
    ctx,
    "llm",
    `Agent stopped after ${maxTurns} turns without finishing.`,
  );
}

interface SearchMatch {
  datasetId: string;
  title: string | null;
  score: number;
  rationale: string;
  priceCents: number | null;
  withinBudget: boolean;
}

async function runScripted(
  runId: string,
  ctx: AgentContext,
): Promise<AgentRunResult> {
  const done = (reasoning: string, datasetId: string | null = null) =>
    result(runId, ctx, "scripted", reasoning, datasetId);

  const search = await executeTool(ctx, "search_datasets", {
    study: ctx.study,
  });
  if (!search.ok) return done(`Search failed: ${search.error}`);
  const matches = (search.output as { matches: SearchMatch[] }).matches.filter(
    (m) => m.score > 0,
  );
  if (matches.length === 0)
    return done("No dataset in the catalog matches this study.");

  const pick = matches.find((m) => m.withinBudget);
  if (!pick) {
    const best = matches[0];
    return done(
      `Best match ${best.datasetId} costs ${best.priceCents === null ? "an unknown price" : dollars(best.priceCents)}, over the ${dollars(ctx.budgetCents)} budget; no matching dataset fits.`,
    );
  }

  const details = await executeTool(ctx, "get_dataset", {
    datasetId: pick.datasetId,
  });
  if (!details.ok) return done(`Could not inspect ${pick.datasetId}.`);

  const sample = await executeTool(ctx, "check_sample", {
    datasetId: pick.datasetId,
    study: ctx.study,
  });
  const check = sample.ok
    ? (sample.output as { passed: boolean; findings: string[] })
    : null;
  if (!check?.passed) {
    const why = check
      ? check.findings.filter((f) => !f.startsWith("PASS")).join("; ")
      : (sample as { error: string }).error;
    return done(
      `${pick.datasetId} failed its sample check, so nothing was bought${why ? `: ${why}` : "."}`,
    );
  }

  const order = await executeTool(ctx, "create_escrow_order", {
    datasetId: pick.datasetId,
    justification: pick.rationale,
  });
  if (!order.ok)
    return done(`Escrow order for ${pick.datasetId} failed: ${order.error}`);
  return done(
    `${pick.title ?? pick.datasetId} is the top match within budget ` +
      `(${dollars(ctx.order!.amountCents)} of ${dollars(ctx.budgetCents)}) and ` +
      `passed its sample check (${pick.rationale}). Escrow order opened; ` +
      `funds are held once you approve it in PayPal.`,
    pick.datasetId,
  );
}

/** Run the procurement agent once. Never throws for LLM failures. */
export async function runProcurementAgent(
  input: AgentRunInput,
  opts: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const runId = `run_${randomUUID()}`;
  const ctx = createAgentContext({
    study: input.study,
    budgetCents: input.budgetCents,
    buyerEmail: input.buyerEmail,
    escrowDeps: opts.escrowDeps,
  });

  if (opts.useLlm ?? llmEnabled()) {
    try {
      return await runLlm(
        runId,
        ctx,
        opts.client ?? getLlmClient(),
        opts.maxTurns ?? MAX_TURNS,
      );
    } catch (err) {
      // Never buy twice: if the model already opened an order, report it.
      if (ctx.order) {
        console.warn(
          `agent: LLM planner failed after ordering (${(err as Error).message})`,
        );
        return result(
          runId,
          ctx,
          "llm",
          `Escrow order opened for ${ctx.order.datasetId}; the agent stopped before summarizing.`,
        );
      }
      console.warn(
        `agent: LLM planner failed, using scripted planner (${(err as Error).message})`,
      );
    }
  }
  return runScripted(runId, ctx);
}
