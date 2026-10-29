// View model for the shareable agent run replay page (/agent/<runId>). Turns a
// stored run into plain display data: readable steps, which guardrails held or
// fired, the shortlist and the recommendation. Pure, so the page stays thin
// and this is easy to test.
import { buildShortlist, type ShortlistItem } from "./shortlist";
import type { StoredAgentRun } from "./store";
import type { AgentStep } from "./tools";

export interface ReplayStep {
  /** 1-based position in the run. */
  n: number;
  label: string;
  /** One line of what went in or came out, or the refusal reason. */
  detail: string;
  refused: boolean;
  at: string;
}

export interface ReplayGuardrail {
  label: string;
  /** "triggered" means the agent tried it and the code refused. */
  status: "enforced" | "triggered";
  detail: string;
}

export interface Replay {
  runId: string;
  study: string;
  budgetCents: number;
  source: StoredAgentRun["source"];
  /** UTC timestamp, e.g. "2026-10-29 14:03:00 UTC". */
  createdAt: string;
  steps: ReplayStep[];
  guardrails: ReplayGuardrail[];
  shortlist: ShortlistItem[];
  recommendation: {
    datasetId: string | null;
    title: string | null;
    reasoning: string;
  };
  orderId: string | null;
}

export const TOOL_LABELS: Record<string, string> = {
  search_datasets: "Searched the catalog",
  get_dataset: "Inspected a dataset",
  check_sample: "Checked a sample",
  create_escrow_order: "Opened an escrow order",
};

// Long prose and URLs are left to the recommendation rather than the step.
const SKIP_KEYS = new Set(["description", "approveUrl", "rationale", "note"]);

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** One-line summary of a tool's input/output, e.g. "datasetId: ds_x". */
export function summarize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  return Object.entries(value as Record<string, unknown>)
    .filter(([k, v]) => v !== null && !SKIP_KEYS.has(k))
    .map(([k, v]) =>
      Array.isArray(v)
        ? `${k}: ${v.length}`
        : typeof v === "object"
          ? null
          : `${k}: ${String(v)}`,
    )
    .filter(Boolean)
    .join(" · ");
}

function replaySteps(steps: AgentStep[]): ReplayStep[] {
  return steps.map((s, i) => ({
    n: i + 1,
    label: TOOL_LABELS[s.tool] ?? s.tool,
    detail: s.error
      ? `Refused: ${s.error}`
      : summarize(s.output) || summarize(s.input),
    refused: s.error !== undefined,
    at: s.at,
  }));
}

function guardrails(
  steps: AgentStep[],
  budgetCents: number,
): ReplayGuardrail[] {
  const refusals = steps.flatMap((s) => (s.error ? [s.error] : []));
  const status = (re: RegExp): ReplayGuardrail["status"] =>
    refusals.some((e) => re.test(e)) ? "triggered" : "enforced";
  return [
    {
      label: "Budget cap",
      status: status(/budget/),
      detail: `Orders priced above ${usd(budgetCents)} are refused.`,
    },
    {
      label: "Sample check first",
      status: status(/sample check/),
      detail: "No order without a passing sample check in the same run.",
    },
    {
      label: "One order per run",
      status: status(/already created/),
      detail: "At most one escrow order can be opened.",
    },
    {
      label: "No money movement",
      status: "enforced",
      detail:
        "The agent can only open an escrow order; the buyer approves it in PayPal.",
    },
  ];
}

function utc(createdAt: string): string {
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC.
  return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(createdAt)
    ? `${createdAt} UTC`
    : createdAt;
}

/** Build the replay page's view model from a stored run. */
export function buildReplay(run: StoredAgentRun): Replay {
  const shortlist = buildShortlist(
    run.steps,
    run.recommendation,
    run.budgetCents,
  );
  const datasetId = run.recommendation?.datasetId ?? null;
  return {
    runId: run.runId,
    study: run.study,
    budgetCents: run.budgetCents,
    source: run.source,
    createdAt: utc(run.createdAt),
    steps: replaySteps(run.steps),
    guardrails: guardrails(run.steps, run.budgetCents),
    shortlist,
    recommendation: {
      datasetId,
      title: shortlist.find((i) => i.datasetId === datasetId)?.title ?? null,
      reasoning: run.recommendation?.reasoning ?? "",
    },
    orderId: run.orderId,
  };
}
