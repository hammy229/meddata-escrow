import type { LlmClient } from "../llm/client";

/** Shared options for the lib/ai features that can call Claude. */
export interface AiOptions {
  /** Inject a client (tests). Defaults to the shared Bedrock client. */
  client?: LlmClient;
  /** Force the LLM path on/off. Defaults to llmEnabled(). */
  useLlm?: boolean;
}
