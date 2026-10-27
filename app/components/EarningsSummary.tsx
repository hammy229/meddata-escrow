"use client";

// Vendor earnings roll-up (client component). Reads GET /api/orders?summary=1
// and shows where the money sits: held in escrow, captured, paid out, and
// released back to buyers — plus a count of orders per escrow state. Polls on
// the same cadence as IncomingOrders so both panels move together; a parent
// can also bump `refreshKey` to refetch immediately.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle } from "./icons";

// Mirrors lib/db OrderSummary. Kept local so this client component never
// imports the server-only db module.
interface OrderSummary {
  countsByStatus: Record<string, number>;
  heldCents: number;
  capturedCents: number;
  paidOutCents: number;
  releasedCents: number;
}

const POLL_MS = 5000;

// Escrow states in lifecycle order, with a readable label and a tone. The
// label always carries the meaning; the tone only reinforces it.
const STATES: { key: string; label: string; cls: string }[] = [
  { key: "MATCHED", label: "Matched", cls: "bg-zinc-400 dark:bg-zinc-500" },
  { key: "AUTHORIZED", label: "Authorized", cls: "bg-pp-400" },
  { key: "DELIVERED", label: "Delivered", cls: "bg-pp-500" },
  { key: "CAPTURED", label: "Captured", cls: "bg-pp-600" },
  { key: "PAID_OUT", label: "Paid out", cls: "bg-pp-800 dark:bg-pp-300" },
  { key: "DISPUTED", label: "Disputed", cls: "bg-amber-500" },
  { key: "VOIDED", label: "Voided", cls: "bg-rose-500" },
  { key: "CANCELLED", label: "Cancelled", cls: "bg-rose-400" },
];

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const tile = "border-t border-rule pt-4";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; summary: OrderSummary };

export default function EarningsSummary({
  refreshKey,
}: {
  refreshKey?: unknown;
}) {
  const [state, setState] = useState<Load>({ status: "loading" });
  // A failed poll keeps the last good numbers on screen and flags them stale.
  const [stale, setStale] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders?summary=1", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.summary) {
        const message = data?.error ?? `Order service responded ${res.status}.`;
        setState((prev) =>
          prev.status === "ready" ? prev : { status: "error", message },
        );
        setStale(message);
        return;
      }
      setState({ status: "ready", summary: data.summary });
      setStale(null);
    } catch {
      const message = "Could not reach the order service.";
      setState((prev) =>
        prev.status === "ready" ? prev : { status: "error", message },
      );
      setStale(message);
    }
  }, []);

  // First fetch is deferred (setTimeout 0) so it runs as an async callback
  // rather than a synchronous setState in the effect, then poll.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load, refreshKey]);

  if (state.status === "error") {
    return (
      <p
        className="inline-flex flex-wrap items-center gap-1.5 rounded-[3px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Earnings unavailable — {state.message}
        <button
          type="button"
          onClick={load}
          className="font-medium text-pp-700 hover:underline dark:text-pp-400"
        >
          Retry
        </button>
      </p>
    );
  }

  const s = state.status === "ready" ? state.summary : null;
  const counts = s
    ? STATES.filter((st) => (s.countsByStatus[st.key] ?? 0) > 0)
    : [];
  const value = (cents: number | undefined) =>
    s ? (
      usd(cents ?? 0)
    ) : (
      <span className="text-zinc-300 dark:text-zinc-700">—</span>
    );

  const tiles: {
    label: string;
    cents: number | undefined;
    hint: string;
    accent?: boolean;
    held?: boolean;
  }[] = [
    {
      label: "In escrow",
      cents: s?.heldCents,
      hint: "Authorized, delivered or disputed",
      held: true,
    },
    {
      label: "Captured",
      cents: s?.capturedCents,
      hint: "Buyer charged",
      accent: true,
    },
    { label: "Paid out", cents: s?.paidOutCents, hint: "Sent to you" },
    {
      label: "Released to buyers",
      cents: s?.releasedCents,
      hint: "Voided authorizations",
    },
  ];

  return (
    <div aria-busy={state.status === "loading"}>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className={tile}>
            <dt className="flex items-center gap-2 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
              {t.held && (t.cents ?? 0) > 0 && (
                <span
                  aria-hidden
                  className="held-dot h-2 w-2 rounded-full bg-pp-500"
                />
              )}
              {t.label}
            </dt>
            <dd
              className={`mt-2 font-serif text-3xl font-light tabular-nums ${
                t.accent ? "text-pp-600 dark:text-pp-400" : ""
              }`}
            >
              {value(t.cents)}
            </dd>
            <dd className="mt-1 text-xs font-light text-muted">{t.hint}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        <span className="mr-1 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
          Orders by state
        </span>
        {state.status === "loading" ? (
          <span className="text-muted" role="status">
            Loading…
          </span>
        ) : counts.length === 0 ? (
          <span className="text-muted">No orders yet.</span>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="Orders by state">
            {counts.map((st) => (
              <li
                key={st.key}
                className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-0.5 text-xs text-zinc-700 dark:text-zinc-300"
              >
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${st.cls}`}
                />
                {st.label}
                <span className="font-mono font-semibold">
                  {s?.countsByStatus[st.key]}
                </span>
              </li>
            ))}
          </ul>
        )}
        {stale && (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3.5 w-3.5" />
            Showing last known figures — {stale}
          </span>
        )}
      </div>
    </div>
  );
}
