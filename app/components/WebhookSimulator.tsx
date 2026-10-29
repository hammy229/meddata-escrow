"use client";

// Mock PayPal webhook simulator (client component), shown only when
// /api/health reports mode "mock". Pick an order and an event, and the payload
// from lib/escrow/mock-webhook-events is POSTed to the real
// /api/webhooks/paypal route with the mock-mode header, so it goes through the
// same dedupe, state-machine and audit path as a real PayPal delivery.
import { useEffect, useState } from "react";
import {
  MOCK_WEBHOOK_KINDS,
  buildMockWebhookEvent,
  type MockWebhookKind,
  type MockWebhookOrder,
} from "../../lib/escrow/mock-webhook-events";

interface OrderRow extends MockWebhookOrder {
  dataset_id: string;
  status: string;
}

const fieldCls =
  "w-full rounded-[3px] border border-ink/20 bg-paper px-3 py-1.5 text-sm outline-none transition-colors focus:border-pp-500 focus:ring-2 focus:ring-pp-500/15 dark:border-zinc-700";

// One-line summary of the route's answer (see app/api/webhooks/paypal).
function describe(status: number, body: Record<string, unknown>): string {
  if (status >= 400) return String(body.error ?? `Rejected (${status}).`);
  if (body.duplicate) return "Duplicate event id, nothing changed.";
  if (body.ignored) return `Ignored: ${String(body.reason)}.`;
  if (body.applied)
    return `Applied ${String(body.applied)}; order is now ${String(body.escrowState)}.`;
  return `Recorded; order stays ${String(body.escrowState)}.`;
}

export default function WebhookSimulator() {
  const [mock, setMock] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderId, setOrderId] = useState("");
  const [kind, setKind] = useState<MockWebhookKind>("capture_completed");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        const health = await res.json().catch(() => ({}));
        if (live && health?.mode === "mock") setMock(true);
      } catch {
        // Unknown mode: keep the simulator hidden.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  async function loadOrders() {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      const rows: OrderRow[] = Array.isArray(data.orders) ? data.orders : [];
      setOrders(rows);
      setOrderId((cur) => (rows.some((o) => o.id === cur) ? cur : ""));
    } catch {
      setOrders([]);
    }
  }

  useEffect(() => {
    if (mock) {
      const t = setTimeout(loadOrders, 0);
      return () => clearTimeout(t);
    }
  }, [mock]);

  if (!mock) return null;

  async function send() {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/webhooks/paypal", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-mock-webhook": "1",
        },
        body: JSON.stringify(buildMockWebhookEvent(kind, order)),
      });
      const body = await res.json().catch(() => ({}));
      setResult({ ok: res.ok, text: describe(res.status, body) });
      await loadOrders();
    } catch {
      setResult({ ok: false, text: "Could not reach the webhook route." });
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="border-t border-rule pt-8 pb-10">
      <h2 className="mb-1 font-serif text-[1.6rem] font-normal">
        Webhook simulator
      </h2>
      <p className="mb-6 text-sm font-light text-muted">
        Mock mode only. Send an order a PayPal event and watch the ledger react.
        An event that does not fit the order&apos;s current state is ignored, as
        it would be in production.
      </p>
      <div className="grid gap-3 sm:grid-cols-[2fr_1.2fr_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Order</span>
          <select
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className={fieldCls}
          >
            <option value="">Choose an order…</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.id.slice(0, 12)} · {o.dataset_id} · {o.status}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Event</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as MockWebhookKind)}
            className={fieldCls}
          >
            {MOCK_WEBHOOK_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={send}
          disabled={!orderId || sending}
          className="rounded-[3px] bg-ink px-4 py-2 text-sm text-paper transition-colors hover:bg-ink/85 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send event"}
        </button>
      </div>
      {result && (
        <p
          role="status"
          className={`mt-3 text-sm ${result.ok ? "text-muted" : "text-amber-700 dark:text-amber-400"}`}
        >
          {result.text}
        </p>
      )}
    </section>
  );
}
