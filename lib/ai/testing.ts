// Test-only fakes for the LLM seam: no network, no AWS. A fake client returns
// a canned structured reply (or throws) and records the request it was sent.
import type { LlmClient } from "../llm/client";

export interface FakeLlm {
  client: LlmClient;
  calls: Record<string, unknown>[];
}

/** A client whose next answer parses to `output`. */
export function fakeLlm(output: unknown): FakeLlm {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        return { stop_reason: "end_turn", parsed_output: output };
      },
    },
  } as unknown as LlmClient;
  return { client, calls };
}

/** A client whose every call rejects (e.g. Bedrock unreachable). */
export function failingLlm(message = "bedrock unavailable"): FakeLlm {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        calls.push(params);
        throw new Error(message);
      },
    },
  } as unknown as LlmClient;
  return { client, calls };
}

/** The user prompt text of a recorded call. */
export function promptOf(call: Record<string, unknown>): string {
  const messages = call.messages as { content: string }[];
  return messages[0].content;
}
