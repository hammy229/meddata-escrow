"use client";

// Escrow audit trail for one order (client component). Reads
// GET /api/orders?id=<id>&events=1 and renders every recorded transition as a
// vertical stepper — genesis first, newest last. The parent bumps `refreshKey`
// after it moves the order so the trail stays live without polling here.
import { useEffect, useState } from "react";
import { AlertTriangle, Check } from "./icons";

// Mirrors lib/db/client OrderEventRow. Kept local so this client component
// never imports the server-only db module.
interface OrderEventRow {
  id: string;
  order_id: string;
  seq: number;
  event: string;
  from_state: string | null;
  to_state: string;
  note: string | null;
  created_at: string;
}

type Tone = "accent" | "warn" | "danger";

const EVENT_META: Record<string, { label: string; tone: Tone }> = {
  CREATE: { label: "Order matched", tone: "accent" },
  AUTHORIZE: { label: "Funds authorized (held)", tone: "accent" },
  DELIVER: { label: "Data delivered", tone: "accent" },
  CAPTURE: { label: "Payment captured", tone: "accent" },
  PAYOUT: { label: "Vendor paid out", tone: "accent" },
  DISPUTE: { label: "Dispute opened", tone: "warn" },
  RESOLVE_CAPTURE: { label: "Resolved — vendor paid", tone: "accent" },
  RESOLVE_VOID: { label: "Resolved — buyer refunded", tone: "danger" },
  VOID: { label: "Authorization voided", tone: "danger" },
  CANCEL: { label: "Order cancelled", tone: "danger" },
};

const DOT: Record<Tone, string> = {
  accent:
    "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500",
  warn: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  danger:
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
};

// States where money is still sitting in escrow — the latest step pulses.
const HELD = new Set(["AUTHORIZED", "DELIVERED", "DISPUTED"]);

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
  | { status: "ready"; events: OrderEventRow[] };

export default function OrderTimeline({
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
          `/api/orders?id=${encodeURIComponent(orderId)}&events=1`,
          { cache: "no-store", signal: ctrl.signal },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setState({
            status: "error",
            message: data?.error ?? `Order service responded ${res.status}.`,
          });
          return;
        }
        setState({
          status: "ready",
          events: Array.isArray(data.events) ? data.events : [],
        });
      } catch {
        if (ctrl.signal.aborted) return;
        setState({
          status: "error",
          message: "Could not load the audit trail.",
        });
      }
    })();
    return () => ctrl.abort();
  }, [orderId, refreshKey, retry]);

  if (state.status === "loading") {
    return (
      <p className="text-sm text-zinc-500" role="status">
        Loading audit trail…
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

  if (state.events.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        No escrow events recorded for this order yet.
      </p>
    );
  }

  const last = state.events.length - 1;

  return (
    <ol className="relative" aria-label={`Escrow audit trail for ${orderId}`}>
      {state.events.map((ev, i) => {
        const meta = EVENT_META[ev.event] ?? {
          label: ev.event,
          tone: "accent" as Tone,
        };
        const d = parseTs(ev.created_at);
        const isLast = i === last;
        return (
          <li key={ev.id} className="relative flex gap-3 pb-5 last:pb-0">
            {!isLast && (
              <span
                aria-hidden
                className="absolute top-6 bottom-0 left-[11px] w-px bg-zinc-200 dark:bg-zinc-800"
              />
            )}
            <span
              aria-hidden
              className={[
                "relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border",
                DOT[meta.tone],
                isLast && HELD.has(ev.to_state) ? "held-dot" : "",
              ].join(" ")}
            >
              {meta.tone === "warn" ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : meta.tone === "accent" ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium">{meta.label}</p>
                {d ? (
                  <time
                    dateTime={d.toISOString()}
                    title={d.toLocaleString()}
                    className="text-xs text-zinc-500"
                  >
                    {relative(d)}
                  </time>
                ) : (
                  <span className="text-xs text-zinc-500">{ev.created_at}</span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-zinc-500">
                {ev.from_state ? (
                  <>
                    {ev.from_state}
                    <span aria-hidden> → </span>
                    <span className="sr-only"> to </span>
                    {ev.to_state}
                  </>
                ) : (
                  ev.to_state
                )}
              </p>
              {ev.note && (
                <blockquote className="mt-2 border-l-2 border-zinc-200 pl-3 text-sm text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400">
                  “{ev.note}”
                </blockquote>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
