"use client";

// Local stand-in for PayPal's approval page (PAYPAL_MODE=mock only).
//
// In mock mode the approve link points here instead of a fake sandbox URL:
// /checkout/mock?token=<paypalOrderId>&orderId=<id>. Approve runs the real
// `authorize` action through PATCH /api/orders; Cancel runs `cancel`.

import { use, useState } from "react";
import Link from "next/link";
import SiteNav from "../../components/SiteNav";

const primaryBtn =
  "inline-flex items-center gap-2 rounded-[3px] bg-ink px-5 py-2.5 text-sm text-paper transition-colors hover:bg-pp-600 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-ink";
const secondaryBtn =
  "inline-flex items-center gap-2 rounded-[3px] border border-ink/25 px-5 py-2.5 text-sm text-ink transition-colors hover:border-ink active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

type Outcome = "approved" | "cancelled";

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default function MockCheckout({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = use(searchParams);
  const token = first(params.token);
  const orderId = first(params.orderId);

  const [busy, setBusy] = useState<"authorize" | "cancel" | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "authorize" | "cancel") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setOutcome(action === "authorize" ? "approved" : "cancelled");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative min-h-[100dvh] bg-paper text-ink">
      <SiteNav current="/checkout/mock" />
      <main className="mx-auto w-full max-w-xl px-5 py-16 sm:px-10 lg:box-content lg:pl-[calc(72px+2.5rem)]">
        <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
          Mock PayPal checkout
        </p>
        <h1 className="mt-3 font-serif text-[2.25rem] leading-tight font-normal">
          Approve this payment hold
        </h1>

        {!orderId ? (
          <p className="mt-6 text-sm text-muted">
            This page needs an <code>orderId</code> in the link. Start from{" "}
            <Link href="/researcher" className="underline">
              the researcher workspace
            </Link>
            .
          </p>
        ) : outcome ? (
          <section className="mt-6 border-t border-rule pt-6">
            <p className="text-[1.05rem] font-light">
              {outcome === "approved"
                ? "Approved. The funds are now held in escrow; nothing has been captured."
                : "Cancelled. No funds were held and the order is closed."}
            </p>
            <Link href="/researcher" className={`mt-6 ${primaryBtn}`}>
              Back to the workspace
            </Link>
          </section>
        ) : (
          <section className="mt-6 border-t border-rule pt-6">
            <p className="text-sm font-light text-muted">
              No real PayPal account is involved. Approving holds the funds in
              the demo escrow; you can still cancel before approving.
            </p>
            <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 font-mono text-xs text-muted">
              <dt>Order</dt>
              <dd className="break-all text-ink">{orderId}</dd>
              {token && (
                <>
                  <dt>Token</dt>
                  <dd className="break-all text-ink">{token}</dd>
                </>
              )}
            </dl>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                onClick={() => act("authorize")}
                disabled={busy !== null}
                className={primaryBtn}
              >
                {busy === "authorize" ? "Approving…" : "Approve"}
              </button>
              <button
                onClick={() => act("cancel")}
                disabled={busy !== null}
                className={secondaryBtn}
              >
                {busy === "cancel" ? "Cancelling…" : "Cancel"}
              </button>
            </div>
            {error && (
              <p className="mt-4 text-sm text-amber-600 dark:text-amber-400">
                {error}
              </p>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
