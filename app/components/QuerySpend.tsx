"use client";

// Per-query spend for one order (client component). Reads
// GET /api/billing?orderId= and shows how many answered queries were billed to
// the order, the running total, and the latest few questions with their
// charge. The parent bumps `refreshKey` after each successful query so the
// tally stays live without polling here.
import { useEffect, useState } from "react";
import { AlertTriangle } from "./icons";

// Mirrors lib/db/usage UsageRow. Kept local so this client component never
// imports the server-only db module.
interface UsageRow {
  id: string;
  order_id: string;
  question: string;
  charge_cents: number;
  created_at: string;
}

const RECENT = 5;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// SQLite "YYYY-MM-DD HH:MM:SS" is UTC without a zone marker.
function parseTs(ts: string): Date | null {
  const iso = ts.includes("T") ? ts : ts.replace(" ", "T");
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function relative(d: Date): string {
  const s = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(s / 86400), "day");
  return d.toLocaleDateString();
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      usage: UsageRow[];
      queryCount: number;
      totalCents: number;
    };

export default function QuerySpend({
  orderId,
  refreshKey,
}: {
  orderId: string;
  refreshKey?: unknown;
}) {
  const [state, setState] = useState<Load>({ status: "loading" });
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/billing?orderId=${encodeURIComponent(orderId)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({
            status: "error",
            message: data?.error ?? `Billing service responded ${res.status}.`,
          });
          return;
        }
        const usage: UsageRow[] = Array.isArray(data.usage) ? data.usage : [];
        setState({
          status: "ready",
          usage,
          queryCount:
            typeof data.queryCount === "number"
              ? data.queryCount
              : usage.length,
          totalCents:
            typeof data.totalCents === "number"
              ? data.totalCents
              : usage.reduce((sum, u) => sum + u.charge_cents, 0),
        });
      } catch {
        if (ctrl.signal.aborted) return;
        setState({ status: "error", message: "Could not load query spend." });
      }
    })();
    return () => ctrl.abort();
  }, [orderId, refreshKey, retry]);

  if (state.status === "loading") {
    return (
      <p className="text-sm text-zinc-500" role="status">
        Loading query spend…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <p
        className="inline-flex flex-wrap items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        {state.message}
        <button
          type="button"
          onClick={() => setRetry((n) => n + 1)}
          className="font-medium text-pp-700 hover:underline dark:text-pp-400"
        >
          Retry
        </button>
      </p>
    );
  }

  const { usage, queryCount, totalCents } = state;
  const recent = usage.slice(0, RECENT);

  return (
    <div>
      <p className="text-sm" role="status">
        <span className="font-mono font-semibold">{queryCount}</span>{" "}
        <span className="text-zinc-500">
          {queryCount === 1 ? "query" : "queries"}
        </span>
        <span aria-hidden className="text-zinc-400">
          {" "}
          ·{" "}
        </span>
        <span className="font-mono font-semibold text-pp-600 dark:text-pp-400">
          {usd(totalCents)}
        </span>{" "}
        <span className="text-zinc-500">billed to this order</span>
      </p>

      {recent.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">
          No queries billed yet. Each answered query is charged to this order.
        </p>
      ) : (
        <ol
          className="mt-3 divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800/70 dark:border-zinc-800"
          aria-label={`Latest ${recent.length} billed queries`}
        >
          {recent.map((u) => {
            const d = parseTs(u.created_at);
            return (
              <li
                key={u.id}
                className="flex items-baseline gap-3 px-4 py-2.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate" title={u.question}>
                  {u.question}
                </span>
                {d ? (
                  <time
                    dateTime={d.toISOString()}
                    title={d.toLocaleString()}
                    className="shrink-0 text-xs text-zinc-500"
                  >
                    {relative(d)}
                  </time>
                ) : (
                  <span className="shrink-0 text-xs text-zinc-500">
                    {u.created_at}
                  </span>
                )}
                <span className="w-14 shrink-0 text-right font-mono text-xs tabular-nums">
                  {usd(u.charge_cents)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {queryCount > recent.length && (
        <p className="mt-2 text-xs text-zinc-500">
          Showing the latest {recent.length} of {queryCount}.
        </p>
      )}
    </div>
  );
}
