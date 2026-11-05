"use client";

// Survival curves for a SYNTHETIC ALS listing: pick a grouping, run it as a
// metered query (POST /api/query { analysis }), see the chart and the raw and
// age-adjusted p side by side. Each run is billed like any other answer.
import { useState } from "react";
import type { SurvivalAnalysis } from "../../lib/query/survival-analysis";
import { PER_QUERY_FEE_CENTS } from "../../lib/query/pricing";
import { groupByLabel } from "../../lib/query/survival-chart";
import SurvivalChart, { PValues } from "./SurvivalChart";
import { AlertTriangle } from "./icons";

const OPTIONS = ["arm", "sex", "onset_site", "age_band"] as const;
type GroupBy = (typeof OPTIONS)[number];

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function SurvivalPanel({
  orderId,
  datasetId,
  onAnswered,
  onCapReached,
  initialGroupBy = "arm",
}: {
  orderId: string;
  datasetId: string;
  /** Called with the charge once a run is billed, so the spend tally can refresh. */
  onAnswered?: (chargeCents: number) => void;
  onCapReached?: (capCents: number) => void;
  initialGroupBy?: GroupBy;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>(initialGroupBy);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<SurvivalAnalysis | null>(null);
  const [charge, setCharge] = useState<number | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId,
          datasetId,
          analysis: { type: "survival", groupBy },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.analysis) {
        setError(data?.error ?? `Survival request failed (${res.status}).`);
        if (res.status === 402 && typeof data?.capCents === "number")
          onCapReached?.(data.capCents);
        return;
      }
      setAnalysis(data.analysis as SurvivalAnalysis);
      const cents =
        typeof data.usage?.chargeCents === "number"
          ? data.usage.chargeCents
          : null;
      setCharge(cents);
      if (cents !== null) onAnswered?.(cents);
    } catch {
      setError("Could not reach the query service.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-8 border-t border-rule pt-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-serif text-[1.3rem] font-normal">
          Survival curves
        </h3>
        <span className="rounded-[3px] border border-ink/30 px-1.5 py-0.5 font-mono text-[0.65rem] tracking-[0.14em]">
          SYNTHETIC
        </span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Kaplan-Meier curves on a 3 month grid. No event dates or rows leave the
        vendor. Groups under 11 people are hidden, with the next smallest group.
        Each run is billed at {usd(PER_QUERY_FEE_CENTS)} like any other answer.
      </p>

      <fieldset className="mt-4">
        <legend className="mb-2 text-xs text-muted">Group by</legend>
        <div className="flex flex-wrap gap-2">
          {OPTIONS.map((o) => (
            <label
              key={o}
              className={`cursor-pointer rounded-[3px] border px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)] ${
                groupBy === o
                  ? "border-ink bg-ink text-paper"
                  : "border-ink/25 hover:border-ink"
              }`}
            >
              <input
                type="radio"
                name={`survival-group-${orderId}`}
                value={o}
                checked={groupBy === o}
                onChange={() => setGroupBy(o)}
                className="sr-only"
              />
              {groupByLabel(o)[0].toUpperCase() + groupByLabel(o).slice(1)}
            </label>
          ))}
        </div>
        {groupBy === "arm" && (
          <p className="mt-2 text-xs text-muted">
            Arm also gets a test within age bands, to show whether a gap is only
            a difference in age.
          </p>
        )}
      </fieldset>

      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="mt-4 inline-flex items-center gap-2 rounded-[3px] bg-ink px-5 py-2.5 text-sm text-paper transition-colors hover:bg-pp-600 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-ink"
      >
        {busy ? "Running…" : "Show survival curves"}
      </button>

      {error && (
        <p
          role="alert"
          className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      {analysis && (
        <div className="reveal mt-6 space-y-6" aria-live="polite">
          <PValues analysis={analysis} />
          <SurvivalChart analysis={analysis} />
          {charge !== null && (
            <p className="text-xs text-muted">
              Billed {usd(charge)} to this order.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
