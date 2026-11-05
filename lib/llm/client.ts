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

import { LlmTimeoutError, tracedCall, type TraceOutcome } from "./trace";

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

/** Longest we wait on one model call before falling back (30 s). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Per-call timeout: LLM_TIMEOUT_MS if it is a positive number, else 30 s. */
export function llmTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const n = Number(env.LLM_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/**
 * Run `call` with an AbortSignal that fires after `timeoutMs`, and reject with
 * LlmTimeoutError at that moment even if the call ignores the signal (a stuck
 * socket). The SDK takes the signal as a request option and stops retrying
 * once it aborts.
 */
export async function withTimeout<T>(
  timeoutMs: number,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new LlmTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  try {
    const pending = call(controller.signal);
    pending.catch(() => {}); // a late failure after the timeout is not news
    return await Promise.race([pending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
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
  /** Name shown in call traces, e.g. "match.rank". Never put data in it. */
  operation?: string;
  system: string;
  prompt: string;
  schema: S;
  /** Short, well-specified extraction tasks don't need deep reasoning. */
  effort?: "low" | "medium" | "high";
  client?: LlmClient;
  /** Give up after this long (default: LLM_TIMEOUT_MS, then 30 s). */
  timeoutMs?: number;
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
  const model = llmModel();
  // Every caller treats a throw as "use the deterministic path", so any
  // non-ok outcome here is a fallback.
  const message = await tracedCall(
    {
      operation: req.operation ?? "unspecified",
      model,
      system: req.system,
      fellBack: () => true,
    },
    () =>
      withTimeout(req.timeoutMs ?? llmTimeoutMs(), (signal) =>
        client.messages.parse(
          {
            model,
            max_tokens: 16000,
            system: req.system,
            messages: [{ role: "user", content: req.prompt }],
            output_config: {
              effort: req.effort ?? "low",
              format: zodOutputFormat(req.schema),
            },
          },
          { signal },
        ),
      ),
    (m): TraceOutcome =>
      m.stop_reason === "refusal"
        ? "refusal"
        : m.stop_reason === "max_tokens"
          ? "truncated"
          : m.parsed_output == null
            ? "no_output"
            : "ok",
  );
  if (message.stop_reason === "refusal")
    throw new Error("LLM declined the request");
  if (message.stop_reason === "max_tokens")
    throw new Error("LLM response was truncated");
  if (message.parsed_output == null)
    throw new Error("LLM returned no structured output");
  return message.parsed_output as z.infer<S>;
}
