"use client";

// Side panel for one ledger order (client component): the escrow audit trail
// (OrderTimeline), the vendor/platform fee split, and the authorization window
// while PayPal is holding the funds (GET /api/orders?id= `authorization`). Opened by clicking a ledger row; Escape
// or the close button dismisses it. The ledger bumps `refreshKey` on each poll
// so the trail and the status stay live while the panel is open.
import { useEffect, useState } from "react";
import type { AuthWindow } from "../../lib/escrow/auth-window";
import { platformFeeCents, vendorPayoutCents } from "../../lib/escrow/fees";
import OrderTimeline from "./OrderTimeline";

// Mirrors the OrdersLedger row (raw DB row from GET /api/orders).
export interface DetailOrder {
  id: string;
  dataset_id: string;
  buyer_email: string;
  status: string;
  amount_cents: number;
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// What each authorization window state means for the vendor.
const WINDOW_LABEL: Record<AuthWindow["state"], string> = {
  honor: "Within PayPal's 3-day honor period",
  valid: "Held, capture before it expires",
  expired: "Expired, PayPal released the hold",
};

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function OrderDetail({
  order,
  refreshKey,
  onClose,
}: {
  order: DetailOrder;
  refreshKey?: unknown;
  onClose: () => void;
}) {
  const [authorization, setAuthorization] = useState<AuthWindow | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/orders?id=${encodeURIComponent(order.id)}`,
          { cache: "no-store", signal: ctrl.signal },
        );
        const data = await res.json().catch(() => ({}));
        const auth = data?.authorization;
        setAuthorization(
          res.ok && auth && typeof auth === "object" ? auth : null,
        );
      } catch {
        // Optional extra: the panel is complete without it.
        if (!ctrl.signal.aborted) setAuthorization(null);
      }
    })();
    return () => ctrl.abort();
  }, [order.id, refreshKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fee = platformFeeCents(order.amount_cents);
  const payout = vendorPayoutCents(order.amount_cents);

  return (
    <aside
      aria-label={`Order ${order.id}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col overflow-y-auto border-l border-rule bg-paper p-6 shadow-xl"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
            Order
          </p>
          <h3 className="mt-1 font-mono text-sm break-all">{order.id}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[3px] border border-ink/25 px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink active:translate-y-px"
        >
          Close
        </button>
      </div>

      <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Dataset</dt>
        <dd className="break-all">{order.dataset_id}</dd>
        <dt className="text-muted">Buyer</dt>
        <dd className="break-all">{order.buyer_email}</dd>
        <dt className="text-muted">Status</dt>
        <dd className="font-mono text-xs">{order.status}</dd>
      </dl>

      <section className="mt-6 border-t border-rule pt-4">
        <h4 className="font-serif text-lg font-normal">Payout split</h4>
        <dl className="mt-3 space-y-1.5 text-sm tabular-nums">
          <div className="flex justify-between">
            <dt className="text-muted">Order amount</dt>
            <dd className="font-mono">{usd(order.amount_cents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Platform fee</dt>
            <dd className="font-mono">{usd(fee)}</dd>
          </div>
          <div className="flex justify-between font-medium">
            <dt>Vendor receives</dt>
            <dd className="font-mono">{usd(payout)}</dd>
          </div>
        </dl>
      </section>

      {authorization && (
        <section className="mt-6 border-t border-rule pt-4">
          <h4 className="font-serif text-lg font-normal">
            Authorization window
          </h4>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Authorized</dt>
              <dd>{fmt(authorization.authorizedAt)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Honor period ends</dt>
              <dd>{fmt(authorization.honorUntil)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Funds held until</dt>
              <dd>{fmt(authorization.expiresAt)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted">
            {WINDOW_LABEL[authorization.state]}
            {authorization.state !== "expired" &&
              ` · ${authorization.daysLeft} day${authorization.daysLeft === 1 ? "" : "s"} left`}
          </p>
        </section>
      )}

      <section className="mt-6 border-t border-rule pt-4">
        <h4 className="mb-4 font-serif text-lg font-normal">Audit trail</h4>
        <OrderTimeline orderId={order.id} refreshKey={refreshKey} />
      </section>
    </aside>
  );
}
