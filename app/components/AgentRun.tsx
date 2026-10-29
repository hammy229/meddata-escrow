"use client";

// "Let the agent buy it" (client component). POSTs the study and a budget to
// /api/agent and shows the run: every tool call in order (refused calls in
// amber with the guardrail's reason), the recommendation, and the escrow
// order the agent opened. The agent can only open a MATCHED order — the buyer
// still approves it in PayPal — so this panel links to approval and stops.
import { useState } from "react";
import type { ColDef } from "ag-grid-community";
import DataGrid from "./DataGrid";
import { SourceBadge } from "./MatchesGrid";
import { AlertTriangle, Check } from "./icons";

// Mirrors lib/agent AgentStep / AgentOrder / AgentRunResult. Kept local so
// this client component never imports server-only agent code.
interface AgentStep {
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string;
  at: string;
}

interface AgentOrder {
  orderId: string;
  datasetId: string;
  approveUrl: string | null;
  escrowState: string;
  amountCents: number;
}

// Mirrors lib/agent/shortlist ShortlistItem.
interface ShortlistItem {
  datasetId: string;
  title: string | null;
  priceCents: number | null;
  fitScore: number | null;
  sampleCheck: "passed" | "failed" | "not_run";
  withinBudget: boolean | null;
  reason: string;
  chosen: boolean;
}

interface AgentRunResult {
  runId: string;
  steps: AgentStep[];
  recommendation: { datasetId: string | null; reasoning: string };
  shortlist?: ShortlistItem[];
  order?: AgentOrder;
  source: "llm" | "scripted";
}

const TOOL_LABELS: Record<string, string> = {
  search_datasets: "Searched the catalog",
  get_dataset: "Inspected a dataset",
  check_sample: "Checked a sample",
  create_escrow_order: "Opened an escrow order",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const SAMPLE_LABELS = {
  passed: "Passed",
  failed: "Failed",
  not_run: "Not run",
};

const SHORTLIST_COLUMNS: ColDef<ShortlistItem>[] = [
  {
    headerName: "Dataset",
    flex: 2,
    minWidth: 180,
    valueGetter: (p) =>
      p.data
        ? `${p.data.chosen ? "✓ " : ""}${p.data.title ?? p.data.datasetId}`
        : "",
    tooltipValueGetter: (p) => p.data?.datasetId,
  },
  {
    field: "priceCents",
    headerName: "Price",
    minWidth: 90,
    valueFormatter: (p) => (p.value == null ? "n/a" : usd(p.value)),
  },
  {
    field: "fitScore",
    headerName: "Fit",
    minWidth: 70,
    valueFormatter: (p) => (p.value == null ? "n/a" : String(p.value)),
  },
  {
    field: "sampleCheck",
    headerName: "Sample",
    minWidth: 100,
    valueFormatter: (p) =>
      SAMPLE_LABELS[p.value as ShortlistItem["sampleCheck"]],
  },
  {
    field: "withinBudget",
    headerName: "In budget",
    minWidth: 100,
    valueFormatter: (p) => (p.value == null ? "n/a" : p.value ? "Yes" : "No"),
  },
  {
    field: "reason",
    headerName: "Why",
    flex: 3,
    minWidth: 240,
    tooltipField: "reason",
  },
];

/** One-line summary of a tool's input/output object, e.g. "datasetId: ds_x". */
// Arrays read as a count ("matches: 2"); long prose and URLs are left to
// the recommendation and order card below rather than crowding the step.
const SKIP_KEYS = new Set(["description", "approveUrl", "rationale"]);

function summarize(value: unknown): string {
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

export default function AgentRun({
  study,
  primaryBtn,
  inputBase,
}: {
  study: string;
  primaryBtn: string;
  inputBase: string;
}) {
  const [budget, setBudget] = useState("60");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [run, setRun] = useState<AgentRunResult | null>(null);

  const budgetCents = Math.round(Number(budget) * 100);
  const validBudget = Number.isFinite(budgetCents) && budgetCents > 0;

  async function start() {
    if (!study.trim() || !validBudget) return;
    setRunning(true);
    setError(null);
    setRun(null);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ study, budgetCents }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !Array.isArray(data.steps)) {
        setError(data?.error ?? `Agent responded ${res.status}.`);
        return;
      }
      setRun(data as AgentRunResult);
    } catch {
      setError("Could not reach the agent.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-muted">Budget (USD)</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={`mt-1 block w-32 font-mono tabular-nums ${inputBase}`}
          />
        </label>
        <button
          onClick={start}
          disabled={running || !study.trim() || !validBudget}
          className={primaryBtn}
        >
          {running ? "Agent working…" : "Let the agent buy it"}
        </button>
        {!study.trim() && (
          <span className="text-sm text-muted">
            Describe your study above first.
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      )}

      {run && (
        <div className="reveal mt-5 space-y-4" aria-live="polite">
          <div className="flex flex-wrap items-center gap-3">
            <SourceBadge
              ai={run.source === "llm"}
              aiLabel="Planned by Claude"
              fallbackLabel="Scripted planner"
            />
            <span className="font-mono text-xs text-zinc-400">{run.runId}</span>
          </div>

          <ol className="space-y-2">
            {run.steps.map((s, i) => (
              <li
                key={i}
                className={
                  s.error
                    ? "rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
                    : "rounded-lg border border-rule px-3 py-2 text-sm"
                }
              >
                <div className="flex items-center gap-2 font-medium">
                  <span className="font-mono text-xs text-zinc-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  {TOOL_LABELS[s.tool] ?? s.tool}
                </div>
                <p className="mt-0.5 truncate text-muted">
                  {s.error
                    ? `Refused: ${s.error}`
                    : summarize(s.output) || summarize(s.input)}
                </p>
              </li>
            ))}
          </ol>

          {run.shortlist && run.shortlist.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-medium">Shortlist</p>
              <DataGrid<ShortlistItem>
                rowData={run.shortlist}
                columnDefs={SHORTLIST_COLUMNS}
                getRowId={(r) => r.datasetId}
                height={Math.min(380, 92 + run.shortlist.length * 46)}
              />
            </div>
          )}

          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">Recommendation: </span>
            {run.recommendation.datasetId ?? "nothing within the guardrails"}
            {run.recommendation.reasoning &&
              ` — ${run.recommendation.reasoning}`}
          </p>

          {run.order && (
            <div className="rounded-[3px] border border-pp-200 bg-pp-50/60 p-4 dark:border-pp-500/30 dark:bg-pp-500/5">
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-pp-800 dark:text-pp-300">
                <Check className="h-4 w-4" />
                Order {run.order.orderId} opened · {usd(run.order.amountCents)}{" "}
                · {run.order.escrowState}
              </p>
              <p className="mt-1 text-sm text-muted">
                Nothing is charged yet: approve in PayPal to hold the funds in
                escrow.
              </p>
              {run.order.approveUrl && (
                <a
                  href={run.order.approveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-sm font-medium text-pp-700 underline underline-offset-4 dark:text-pp-400"
                >
                  Approve in PayPal
                </a>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
