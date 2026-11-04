"use client";

// Settle a dispute (client component), on both the researcher and vendor pages.
// Shows the arbiter's advice, which can't move money, and lets either side offer
// a split. The other side accepts, and only then does PayPal capture that part
// and release the rest. Polls so an offer from the other side appears by itself.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "./icons";
import { offerView, parseSplit } from "../../lib/ui/split";

interface DisputedOrder {
  status: string;
  amount_cents: number;
  split_offer_cents?: number | null;
  split_offer_by?: string | null;
}

interface Recommendation {
  outcome: "refund" | "release" | "split" | "needs_human";
  confidence: number;
  rationale: string;
  source: "llm" | "rules";
  suggestedCaptureCents?: number;
}

const OUTCOME_LABEL: Record<Recommendation["outcome"], string> = {
  refund: "Refund the buyer",
  release: "Release the payment",
  split: "Split the payment",
  needs_human: "A person should decide",
};

const POLL_MS = 4000;

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const button =
  "rounded-[3px] px-4 py-2 text-sm transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

export default function DisputePanel({
  orderId,
  role,
  onSettled,
}: {
  orderId: string;
  role: "researcher" | "vendor";
  onSettled?: () => void;
}) {
  const [order, setOrder] = useState<DisputedOrder | null>(null);
  const [advice, setAdvice] = useState<Recommendation | null>(null);
  const [figure, setFigure] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/orders?id=${encodeURIComponent(orderId)}`,
    ).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (res?.ok && data?.order) setOrder(data.order as DisputedOrder);
  }, [orderId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first read, then poll
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // The advice is read once: with Bedrock on, each read is a model call.
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/orders?id=${encodeURIComponent(orderId)}&arbitrate=1`,
          { signal: ctrl.signal },
        );
        const data = await res.json().catch(() => null);
        const rec = data?.recommendation as Recommendation | undefined;
        if (!res.ok || !rec) return;
        setAdvice(rec);
        if (rec.suggestedCaptureCents)
          setFigure((rec.suggestedCaptureCents / 100).toFixed(2));
      } catch {
        // Optional extra: the panel works without advice.
      }
    })();
    return () => ctrl.abort();
  }, [orderId]);

  async function send(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId, ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `The order service answered ${res.status}.`);
        await load();
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the order service.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    if (!order) return;
    const parsed = parseSplit(figure, order.amount_cents);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (
      await send({ action: "propose_split", captureCents: parsed.captureCents })
    )
      await load();
  }

  async function accept(captureCents: number) {
    if (await send({ action: "resolve", resolution: "split", captureCents })) {
      await load();
      onSettled?.();
    }
  }

  if (!order || order.status !== "DISPUTED") return null;

  const offer = offerView(order, role);
  const preview = parseSplit(figure, order.amount_cents);
  const other = role === "vendor" ? "buyer" : "vendor";

  return (
    <div className="mt-4 w-full border border-rule p-4 text-sm">
      {advice && (
        <div className="border-b border-rule pb-3">
          <p className="inline-flex items-center gap-1.5 font-medium">
            <ShieldCheck className="h-4 w-4 text-pp-600" />
            {advice.source === "llm" ? "Claude" : "Rules"} suggest:{" "}
            {OUTCOME_LABEL[advice.outcome]}
            <span className="font-mono text-xs font-normal text-muted">
              {Math.round(advice.confidence * 100)}% sure
            </span>
          </p>
          <p className="mt-1 text-muted">{advice.rationale}</p>
          <p className="mt-1 text-xs text-muted">
            Advice only. It cannot move money.
          </p>
        </div>
      )}

      {offer.kind === "theirs" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p>
            The {other} offers: vendor keeps{" "}
            <span className="font-mono">{usd(offer.captureCents)}</span>, buyer
            gets <span className="font-mono">{usd(offer.refundCents)}</span>{" "}
            back.
          </p>
          <button
            onClick={() => void accept(offer.captureCents)}
            disabled={busy}
            className={`${button} bg-ink text-paper hover:bg-pp-600`}
          >
            {busy ? "Settling…" : "Accept split"}
          </button>
        </div>
      )}
      {offer.kind === "mine" && (
        <p className="mt-3">
          You offered: vendor keeps{" "}
          <span className="font-mono">{usd(offer.captureCents)}</span>, buyer
          gets <span className="font-mono">{usd(offer.refundCents)}</span> back.
          Waiting for the {other}.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label>
          <span className="text-muted">Vendor keeps (USD)</span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={figure}
            onChange={(e) => setFigure(e.target.value)}
            className="mt-1 block w-32 rounded-[3px] border border-ink/20 bg-paper px-3 py-2 font-mono tabular-nums outline-none focus:border-pp-500"
          />
        </label>
        <button
          onClick={() => void propose()}
          disabled={busy}
          className={`${button} border border-ink/25 text-ink hover:border-ink`}
        >
          {offer.kind === "none" ? "Offer a split" : "Send a new offer"}
        </button>
        {preview.ok && (
          <span className="py-2 text-muted">
            Buyer gets {usd(preview.refundCents)} back
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      )}
    </div>
  );
}
