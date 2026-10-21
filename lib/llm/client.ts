// LLM provider seam (Claude on Amazon Bedrock).
//
// Every AI feature (dataset matching, plain-English -> query plans, the
// procurement agent) goes through this module, so there is exactly one place
// that knows how to reach Claude. The real provider is Claude on Bedrock via
// the official Anthropic Bedrock SDK (Mantle client); credentials come from the
// standard AWS chain (~/.aws, env, or an instance role) — never from code.
//
// MOCK BY DEFAULT: unless LLM_PROVIDER=bedrock is set, `llmEnabled()` is false
// and callers use their deterministic local fallbacks, so the app, tests, and
// CI run with no AWS account and no network. Callers must treat any LLM error
// as "fall back", never as a crash.
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";

/** Bedrock model id for Claude Opus 5.5 (override with LLM_MODEL). */
export const DEFAULT_MODEL = "anthropic.claude-opus-5-5";

/** Whether real LLM calls are enabled (explicit opt-in). */
export function llmEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.LLM_PROVIDER === "bedrock";
}

export function llmModel(
  env: Record<string, string | undefined> = process.env,
): string {
  return env.LLM_MODEL || DEFAULT_MODEL;
}

/** The narrow slice of the SDK client we use — lets tests inject a fake. */
export type LlmClient = Pick<AnthropicBedrockMantle, "messages">;

let cached: LlmClient | null = null;

/** Shared Bedrock client (lazily constructed, region from AWS_REGION). */
export function getLlmClient(): LlmClient {
  cached ??= new AnthropicBedrockMantle({
    awsRegion: process.env.AWS_REGION || "us-east-1",
  });
  return cached;
}

export interface StructuredRequest<S extends z.ZodType> {
  system: string;
  prompt: string;
  schema: S;
  /** Short, well-specified extraction tasks don't need deep reasoning. */
  effort?: "low" | "medium" | "high";
  client?: LlmClient;
}

/**
 * One Claude call whose answer is validated against `schema` (structured
 * outputs). Throws on refusal, truncation, or a missing parse so callers can
 * fall back to their deterministic path.
 */
export async function structured<S extends z.ZodType>(
  req: StructuredRequest<S>,
): Promise<z.infer<S>> {
  const client = req.client ?? getLlmClient();
  const message = await client.messages.parse({
    model: llmModel(),
    max_tokens: 16000,
    system: req.system,
    messages: [{ role: "user", content: req.prompt }],
    output_config: {
      effort: req.effort ?? "low",
      format: zodOutputFormat(req.schema),
    },
  });
  if (message.stop_reason === "refusal")
    throw new Error("LLM declined the request");
  if (message.stop_reason === "max_tokens")
    throw new Error("LLM response was truncated");
  if (message.parsed_output == null)
    throw new Error("LLM returned no structured output");
  return message.parsed_output as z.infer<S>;
}
