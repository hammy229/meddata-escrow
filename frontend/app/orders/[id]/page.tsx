"use client";

import { useEffect, useState, useCallback } from "react";
import { Order } from "@/lib/types";

const STEPS: { key: Order["state"]; label: string }[] = [
  { key: "PENDING_PAYMENT", label: "1. Payment" },
  { key: "FUNDED", label: "2. In escrow" },
  { key: "RELEASED", label: "3. Released" },
];

const ORDER = ["PENDING_PAYMENT", "FUNDED", "RELEASED"];

export default function OrderPage({ params }: { params: { id: string } }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [downloadLink, setDownloadLink] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/orders/${params.id}`);
    if (r.ok) setOrder(await r.json());
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function approveAndPay() {
    setBusy(true);
    setErr(null);
    // Mock PayPal approval: capture + fund in one call.
    const r = await fetch(`/api/orders/${params.id}/capture`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) setErr(data.error);
    else setOrder(data);
    setBusy(false);
  }

  async function getDownload() {
    setErr(null);
    const r = await fetch(`/api/orders/${params.id}/download`);
    const data = await r.json();
    if (!r.ok) setErr(data.error);
    else setDownloadLink(data.url);
  }

  async function confirm() {
    setBusy(true);
    const r = await fetch(`/api/orders/${params.id}/confirm`, { method: "POST" });
    const data = await r.json();
    if (!r.ok) setErr(data.error);
    else setOrder(data);
    setBusy(false);
  }

  if (!order) return <p className="notice">Loading order…</p>;

  const idx = ORDER.indexOf(order.state);

  return (
    <>
      <h1>Order status</h1>
      <p className="sub">
        Order <code className="mono">{order.order_id.slice(0, 12)}</code> ·{" "}
        <span className={`state-pill state-${order.state}`}>{order.state.replace("_", " ")}</span>
      </p>

      <div className="steps">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={`step ${i < idx ? "done" : ""} ${i === idx ? "active" : ""}`}
          >
            {s.label}
          </div>
        ))}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="price">Amount held in escrow</span>
          <span className="price">${order.amount}</span>
        </div>
      </div>

      {order.state === "PENDING_PAYMENT" && (
        <div className="card">
          <h2>Pay into escrow</h2>
          <p className="notice">
            Your payment is captured by PayPal and held. The seller is not paid until you confirm
            the dataset. In sandbox mode this is where the real PayPal button renders.
          </p>
          <div className="spacer" />
          <button className="paypal" onClick={approveAndPay} disabled={busy}>
            {busy ? "Processing…" : "Pay with PayPal (mock)"}
          </button>
        </div>
      )}

      {order.state === "FUNDED" && (
        <div className="card">
          <h2>Data unlocked</h2>
          <p className="notice">
            Escrow is funded, so the dataset download is now available. Review it, then release
            payment to the seller.
          </p>
          <div className="spacer" />
          <div className="row">
            {!downloadLink ? (
              <button onClick={getDownload}>Get download link</button>
            ) : (
              <a className="link" href={downloadLink} target="_blank" rel="noreferrer">
                {downloadLink}
              </a>
            )}
            <button className="secondary" onClick={confirm} disabled={busy}>
              Confirm & release payment
            </button>
          </div>
        </div>
      )}

      {order.state === "RELEASED" && (
        <div className="card">
          <h2>Complete</h2>
          <p className="notice">
            Payment released to the seller and the transaction is closed. This is your end-to-end
            proof the escrow flow works.
          </p>
        </div>
      )}

      {err && <p className="error">{err}</p>}
      <div className="spacer" />
      <a className="link" href="/">← Back to search</a>
    </>
  );
}
