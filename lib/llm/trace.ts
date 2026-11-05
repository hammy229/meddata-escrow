// Model-call tracing: one small event per Claude call, so latency, token use,
// refusals and fallbacks can be read off a run instead of guessed.
//
// An event holds only metadata: operation name, model id, a short hash of the
// system prompt (so a prompt change shows up as a new "prompt version"),
// latency, token counts from the response usage, an outcome, and whether the
// caller fell back to its deterministic path. It NEVER holds prompts, study
// text, dataset rows or error messages (SDK errors can echo request content);
// failures record only the outcome. No prices are stored: multiply the token
// counts by whatever rate applies when you read them.
//
// Sinks are pluggable. The default is a bounded in-memory ring buffer; set
// LLM_TRACE_LOG=1 to also write one JSON line per call to stderr (stderr, so
// the stdio MCP server's stdout stays clean).
import { createHash } from "node:crypto";

export type TraceOutcome =
  "ok" | "refusal" | "truncated" | "no_output" | "error" | "timeout";

export interface TraceEvent {
  /** ISO time the call finished. */
  at: string;
  operation: string;
  model: string;
  /** First 8 hex chars of sha256(system prompt). */
  promptVersion: string;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  outcome: TraceOutcome;
  /** True when the caller went on without this answer (deterministic path). */
  fellBack: boolean;
}

export interface TraceSink {
  record(event: TraceEvent): void;
  /** Oldest first. Sinks that keep nothing return []. */
  recent(): TraceEvent[];
}

export function promptVersion(system: string): string {
  return createHash("sha256").update(system).digest("hex").slice(0, 8);
}

/** Keeps the newest `capacity` events. */
export function createRingSink(capacity = 500): TraceSink {
  const events: TraceEvent[] = [];
  return {
    record(event) {
      events.push(event);
      if (events.length > capacity) events.splice(0, events.length - capacity);
    },
    recent: () => [...events],
  };
}

/** Writes each event as one JSON line through `write`. */
export function jsonLineSink(write: (line: string) => void): TraceSink {
  return {
    record: (event) => write(JSON.stringify(event)),
    recent: () => [],
  };
}

function defaultSink(): TraceSink {
  const ring = createRingSink();
  if (process.env.LLM_TRACE_LOG !== "1") return ring;
  const log = jsonLineSink((line) => process.stderr.write(`${line}\n`));
  return {
    record(event) {
      ring.record(event);
      log.record(event);
    },
    recent: () => ring.recent(),
  };
}

let sink: TraceSink = defaultSink();

export function setTraceSink(next: TraceSink): void {
  sink = next;
}

/** Events held by the active sink, oldest first. */
export function recentTraces(): TraceEvent[] {
  return sink.recent();
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Marker for a call we gave up waiting on (see ./client). */
export class LlmTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`LLM call timed out after ${timeoutMs}ms`);
    this.name = "LlmTimeoutError";
  }
}

export interface TracedCallMeta {
  operation: string;
  model: string;
  system: string;
  /** Asked after a non-ok outcome: did the caller carry on without it? */
  fellBack: () => boolean;
}

/**
 * Run one model call and record an event. `classify` maps a returned response
 * to an outcome; a thrown error is "timeout" or "error". The response (or the
 * error) is passed through untouched, and a broken sink never affects it.
 */
export async function tracedCall<T>(
  meta: TracedCallMeta,
  call: () => Promise<T>,
  classify: (response: T) => TraceOutcome,
): Promise<T> {
  const start = performance.now();
  let outcome: TraceOutcome = "error";
  let response: T | undefined;
  try {
    response = await call();
    outcome = classify(response);
    return response;
  } catch (err) {
    outcome = err instanceof LlmTimeoutError ? "timeout" : "error";
    throw err;
  } finally {
    const usage = (
      response as {
        usage?: { input_tokens?: unknown; output_tokens?: unknown };
      }
    )?.usage;
    const event: TraceEvent = {
      at: new Date().toISOString(),
      operation: meta.operation,
      model: meta.model,
      promptVersion: promptVersion(meta.system),
      latencyMs: Math.round(performance.now() - start),
      inputTokens: tokenCount(usage?.input_tokens),
      outputTokens: tokenCount(usage?.output_tokens),
      outcome,
      fellBack: outcome !== "ok" && meta.fellBack(),
    };
    try {
      sink.record(event);
    } catch {
      // Tracing must never break a model call.
    }
  }
}

export interface OperationSummary {
  calls: number;
  outcomes: Partial<Record<TraceOutcome, number>>;
  fallbacks: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Per-operation rollup of events (nearest-rank percentiles). */
export function summarizeTraces(
  events: TraceEvent[],
): Record<string, OperationSummary> {
  const byOp = new Map<string, TraceEvent[]>();
  for (const e of events)
    byOp.set(e.operation, [...(byOp.get(e.operation) ?? []), e]);
  const out: Record<string, OperationSummary> = {};
  for (const [op, list] of byOp) {
    const latencies = list.map((e) => e.latencyMs).sort((a, b) => a - b);
    const outcomes: OperationSummary["outcomes"] = {};
    for (const e of list) outcomes[e.outcome] = (outcomes[e.outcome] ?? 0) + 1;
    out[op] = {
      calls: list.length,
      outcomes,
      fallbacks: list.filter((e) => e.fellBack).length,
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      inputTokens: list.reduce((n, e) => n + (e.inputTokens ?? 0), 0),
      outputTokens: list.reduce((n, e) => n + (e.outputTokens ?? 0), 0),
    };
  }
  return out;
}
