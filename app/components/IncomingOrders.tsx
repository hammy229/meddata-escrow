"use client";

// Vendor incoming-orders view (client component). Polls GET /api/orders for the
// live order book and renders each order's escrow state. Disputed orders expose
// the resolve controls — "Release to vendor" (resolve: capture) or "Refund
// buyer" (resolve: void) — which PATCH /api/orders against the new contract
// ({ action: "resolve", resolution, orderId }); the server is authoritative for
// the from-state and PayPal ids, so we send nothing else.
import { Fragment, useCallback, useEffect, useState } from "react";
import OrderTimeline from "./OrderTimeline";

// Mirrors lib/db/client OrderRow (the GET endpoint returns raw DB rows). Kept
// local so this client component never imports the server-only db module.
interface OrderRow {
  id: string;
  dataset_id: string;
  buyer_email: string;
  paypal_order_id: string | null;
  authorization_id: string | null;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string | null;
}

const POLL_MS = 5000;

// Escrow state -> badge styling. Held/terminal/disputed states get their own
// accent so the book is scannable at a glance.
const STATE_BADGE: Record<string, string> = {
  MATCHED:
    "border-rule bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  AUTHORIZED:
    "border-pp-300 bg-pp-50 text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300",
  DELIVERED:
    "border-pp-300 bg-pp-50 text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300",
  CAPTURED:
    "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500",
  PAID_OUT:
    "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500",
  DISPUTED:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  VOIDED:
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  CANCELLED:
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function when(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts.includes("Z") || ts.includes("T") ? ts : `${ts}Z`);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function StateBadge({ status }: { status: string }) {
  const cls = STATE_BADGE[status] ?? STATE_BADGE.MATCHED;
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-xs ${cls}`}
    >
      {status}
    </span>
  );
}

const resolveBtn =
  "rounded-[3px] px-3 py-1.5 text-xs transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

export default function IncomingOrders() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [disputesOnly, setDisputesOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Orders whose audit timeline is expanded, and a per-order counter bumped
  // after the vendor acts so an open timeline refetches immediately.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [acted, setActed] = useState<Record<string, number>>({});

  function toggleHistory(orderId: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Order service responded ${res.status}.`);
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setError(null);
    } catch {
      setError("Could not reach the order service.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + polling so the book reflects buyer-side escrow moves live.
  // The first fetch is deferred (setTimeout 0) rather than called inline, so it
  // runs as an async callback instead of a synchronous setState in the effect.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load]);

  // Resolve a disputed order: capture = release the held funds to the vendor;
  // void = refund the buyer. On success we refetch so the row reflects the DB.
  async function resolve(orderId: string, resolution: "capture" | "void") {
    setBusyId(orderId);
    setNote(null);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "resolve", resolution, orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setNote(
          resolution === "capture"
            ? `Dispute resolved — funds released to vendor (${data.escrowState ?? "CAPTURED"}).`
            : `Dispute resolved — buyer refunded (${data.escrowState ?? "VOIDED"}).`,
        );
        await load();
      } else {
        setNote(data?.error ?? `Resolve failed (${res.status}).`);
      }
    } catch {
      setNote("Could not reach the order service.");
    } finally {
      setBusyId(null);
      setActed((prev) => ({ ...prev, [orderId]: (prev[orderId] ?? 0) + 1 }));
    }
  }

  const rows = disputesOnly
    ? orders.filter((o) => o.status === "DISPUTED")
    : orders;
  const disputeCount = orders.filter((o) => o.status === "DISPUTED").length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {loading
            ? "Loading orders…"
            : `${orders.length} order${orders.length === 1 ? "" : "s"}` +
              (disputeCount > 0 ? ` · ${disputeCount} disputed` : "")}
        </p>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={disputesOnly}
            onChange={(e) => setDisputesOnly(e.target.checked)}
            className="h-4 w-4 accent-pp-600"
          />
          Disputes only
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-[3px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          {error}
        </div>
      )}

      {note && <p className="mb-4 text-sm text-muted">{note}</p>}

      {!loading && rows.length === 0 ? (
        <p className="rounded-[3px] border border-dashed border-zinc-300 p-8 text-center text-sm text-muted dark:border-zinc-700">
          {disputesOnly
            ? "No disputed orders."
            : "No orders yet. Orders appear here once a buyer authorizes escrow."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs uppercase tracking-wider text-muted">
                <th className="py-2 pr-4 font-medium">Order</th>
                <th className="py-2 pr-4 font-medium">Dataset</th>
                <th className="py-2 pr-4 font-medium">Buyer</th>
                <th className="py-2 pr-4 font-medium">Amount</th>
                <th className="py-2 pr-4 font-medium">State</th>
                <th className="py-2 pr-4 font-medium">Updated</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const expanded = open.has(o.id);
                const panelId = `history-${o.id}`;
                return (
                  <Fragment key={o.id}>
                    <tr className={expanded ? "" : "border-b border-rule"}>
                      <td className="py-3 pr-4 font-mono text-xs text-muted">
                        {o.id}
                      </td>
                      <td className="py-3 pr-4">{o.dataset_id}</td>
                      <td className="py-3 pr-4 text-muted">{o.buyer_email}</td>
                      <td className="py-3 pr-4 tabular-nums">
                        {usd(o.amount_cents)}
                      </td>
                      <td className="py-3 pr-4">
                        <StateBadge status={o.status} />
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted">
                        {when(o.updated_at ?? o.created_at)}
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          {o.status === "DISPUTED" && (
                            <>
                              <button
                                onClick={() => resolve(o.id, "capture")}
                                disabled={busyId !== null}
                                className={`${resolveBtn} bg-ink text-paper hover:bg-pp-600`}
                              >
                                {busyId === o.id
                                  ? "Resolving…"
                                  : "Release to vendor"}
                              </button>
                              <button
                                onClick={() => resolve(o.id, "void")}
                                disabled={busyId !== null}
                                className={`${resolveBtn} border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10`}
                              >
                                {busyId === o.id
                                  ? "Resolving…"
                                  : "Refund buyer"}
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => toggleHistory(o.id)}
                            aria-expanded={expanded}
                            aria-controls={panelId}
                            className={`${resolveBtn} whitespace-nowrap border border-ink/25 text-ink hover:border-ink`}
                          >
                            {expanded ? "Hide history" : "History"}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {/* Always rendered (hidden when collapsed) so aria-controls
                        resolves; the timeline only mounts — and fetches — when
                        expanded. */}
                    <tr
                      id={panelId}
                      hidden={!expanded}
                      className="border-b border-rule"
                    >
                      <td colSpan={7} className="pb-5 pl-4 pt-1">
                        {expanded && (
                          <div className="reveal max-w-2xl rounded-[3px] border border-rule bg-foreground/[0.025] p-4">
                            <OrderTimeline
                              orderId={o.id}
                              refreshKey={`${o.status}:${o.updated_at}:${acted[o.id] ?? 0}`}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
