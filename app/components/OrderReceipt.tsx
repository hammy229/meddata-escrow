"use client";

// Receipt for a captured order (client component). Reads
// GET /api/orders?id=&receipt=1 and lays out what was paid, the platform fee,
// the vendor payout and the metered query charges. Renders nothing until the
// order is captured, and nothing if the server sends no `receipt` (older API)
// or the request fails: a missing receipt is not an error worth showing.
import { useEffect, useState } from "react";

interface Receipt {
  amountCents: number;
  platformFeeCents: number;
  vendorPayoutCents: number;
  queryCount: number;
  queryChargesCents: number;
  totalCents: number;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Accept the receipt only if every figure is a number; anything else is
// treated as absent rather than shown half-filled.
function parseReceipt(raw: unknown): Receipt | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const keys = [
    "amountCents",
    "platformFeeCents",
    "vendorPayoutCents",
    "queryCount",
    "queryChargesCents",
    "totalCents",
  ] as const;
  if (!keys.every((k) => typeof r[k] === "number")) return null;
  return {
    amountCents: r.amountCents as number,
    platformFeeCents: r.platformFeeCents as number,
    vendorPayoutCents: r.vendorPayoutCents as number,
    queryCount: r.queryCount as number,
    queryChargesCents: r.queryChargesCents as number,
    totalCents: r.totalCents as number,
  };
}

export default function OrderReceipt({
  orderId,
  status,
  refreshKey,
}: {
  orderId: string;
  /** Escrow state; the receipt only exists once it is CAPTURED or PAID_OUT. */
  status: string | null;
  /** Bump to refetch, e.g. after another billed query. */
  refreshKey?: unknown;
}) {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const captured = status === "CAPTURED" || status === "PAID_OUT";

  useEffect(() => {
    if (!captured) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/orders?id=${encodeURIComponent(orderId)}&receipt=1`,
          { cache: "no-store", signal: ctrl.signal },
        );
        const data = await res.json().catch(() => ({}));
        setReceipt(res.ok ? parseReceipt(data?.receipt) : null);
      } catch {
        if (!ctrl.signal.aborted) setReceipt(null);
      }
    })();
    return () => ctrl.abort();
  }, [orderId, captured, status, refreshKey]);

  if (!captured || !receipt) return null;

  const rows: [string, string][] = [
    ["Amount paid", usd(receipt.amountCents)],
    ["Platform fee", usd(receipt.platformFeeCents)],
    ["Vendor payout", usd(receipt.vendorPayoutCents)],
    [
      `Query charges (${receipt.queryCount} ${receipt.queryCount === 1 ? "query" : "queries"})`,
      usd(receipt.queryChargesCents),
    ],
  ];

  return (
    <div className="reveal mt-6 border-t border-rule pt-5">
      <h3 className="mb-3 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
        Receipt
      </h3>
      <dl className="max-w-md text-sm">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-6 border-b border-rule py-2"
          >
            <dt className="text-muted">{label}</dt>
            <dd className="font-mono tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-6 py-2 font-medium">
          <dt>Total</dt>
          <dd className="font-mono tabular-nums">{usd(receipt.totalCents)}</dd>
        </div>
      </dl>
    </div>
  );
}
