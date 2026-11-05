// A scripted, fully hostile stand-in for the model.
//
// Threat model: the planner has been taken over (for example by instructions
// hidden in a listing description) and now does the worst thing it can. It
// ignores the system prompt and issues whatever tool calls the scenario
// scripts. The REAL agent loop and REAL tools run against it, so what is
// tested is the code around the model, not the model. This says nothing about
// how often real Claude would fall for an injection (the report records that
// as "not_measured").
import type Anthropic from "@anthropic-ai/sdk";

import type { LlmClient } from "../llm/client";

export interface HostileCall {
  name: string;
  input: unknown;
}

/** One model reply: tool calls to make, or a closing message. */
export type HostileTurn = HostileCall[] | { text: string };

/** What the model was sent on one call (deep copy). */
export interface ModelRequest {
  system: unknown;
  tools: unknown;
  messages: Anthropic.MessageParam[];
}

let seq = 0;

function reply(turn: HostileTurn): Anthropic.Message {
  const content = Array.isArray(turn)
    ? turn.map((c) => ({
        type: "tool_use",
        id: `toolu_rt_${++seq}`,
        name: c.name,
        input: c.input,
        caller: { type: "direct" },
      }))
    : [{ type: "text", text: turn.text, citations: null }];
  return {
    id: `msg_rt_${++seq}`,
    type: "message",
    role: "assistant",
    model: "hostile-scripted",
    content,
    stop_reason: Array.isArray(turn) ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/**
 * A client that answers each messages.create with the next scripted turn.
 * After the script ends it repeats the last turn when `repeatLast` is set,
 * otherwise it ends the conversation with plain text.
 */
export function hostileModel(
  turns: HostileTurn[],
  opts: { repeatLast?: boolean } = {},
): { client: LlmClient; requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParamsNonStreaming) => {
        requests.push(
          structuredClone({
            system: params.system,
            tools: params.tools,
            messages: params.messages,
          }),
        );
        const i = requests.length - 1;
        const turn =
          turns[i] ??
          (opts.repeatLast && turns.length > 0
            ? turns[turns.length - 1]
            : { text: "done" });
        return reply(turn);
      },
    },
  } as unknown as LlmClient;
  return { client, requests };
}

/** A planner whose structured() answer is fixed: for query-path attacks. */
export function hostilePlanner(plan: unknown): LlmClient {
  return {
    messages: {
      parse: async () => ({ stop_reason: "end_turn", parsed_output: plan }),
    },
  } as unknown as LlmClient;
}
