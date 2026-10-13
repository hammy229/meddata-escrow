"use client";

import { useEffect, useState, useCallback } from "react";
import { Order } from "@/lib/types";
import {
  ShieldCheck,
  Lock,
  LockOpen,
  Download,
  Check,
  ArrowLeft,
} from "../../icons";

const STEPS: { key: Order["state"]; label: string; sub: string }[] = [
  { key: "PENDING_PAYMENT", label: "Payment", sub: "Pay into escrow" },
  { key: "FUNDED", label: "In escrow", sub: "Data unlocked" },
  { key: "RELEASED", label: "Released", sub: "Seller paid" },
];

const ORDER = ["PENDING_PAYMENT", "FUNDED", "RELEASED"];

const STATE_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  FUNDED: "Held in escrow",
  RELEASED: "Released",
  REFUNDED: "Refunded",
  CANCELLED: "Cancelled",
};

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

  if (!order) {
    return (
      <>
        <div className="section-label">Order</div>
        <div className="card">
          <div className="skel" style={{ height: 20, width: "40%" }} />
          <div className="skel" style={{ height: 14, width: "70%", marginTop: 14 }} />
        </div>
      </>
    );
  }

  const idx = ORDER.indexOf(order.state);

  return (
    <>
      <div className="flow-head">
        <div>
          <h1 style={{ fontSize: 32, marginBottom: 8 }}>Escrow order</h1>
          <span className="order-id">#{order.order_id.slice(0, 12)}</span>
        </div>
        <span className={`state-pill state-${order.state}`}>
          <span className="dot" />
          {STATE_LABEL[order.state] ?? order.state.replace("_", " ")}
        </span>
      </div>

      <div className="timeline">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={`step ${i < idx ? "done" : ""} ${i === idx ? "active" : ""}`}
          >
            <span className="marker">{i < idx ? <Check size={13} /> : i + 1}</span>
            <div className="st-label">{s.label}</div>
            <div className="st-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="amount-row">
          <span className="label">
            <span className="lock-chip">
              {order.state === "RELEASED" ? <LockOpen size={17} /> : <Lock size={17} />}
            </span>
            {order.state === "RELEASED" ? "Released to seller" : "Amount held in escrow"}
          </span>
          <span className="big">${order.amount}</span>
        </div>
      </div>

      {order.state === "PENDING_PAYMENT" && (
        <div className="card fade-in">
          <div className="panel-head">
            <span className="p-icon">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h2>Pay into escrow</h2>
              <p className="notice">
                PayPal captures your payment and holds it. The seller isn&rsquo;t paid until{" "}
                <strong>you</strong> confirm the dataset. In sandbox mode the real PayPal
                button renders here.
              </p>
            </div>
          </div>
          <div className="spacer" />
          <button className="paypal" onClick={approveAndPay} disabled={busy}>
            {busy ? (
              "Processing…"
            ) : (
              <>
                Pay with{" "}
                <b>
                  <i className="pp-a">Pay</i>
                  <i className="pp-b">Pal</i>
                </b>
              </>
            )}
          </button>
        </div>
      )}

      {order.state === "FUNDED" && (
        <div className="card fade-in">
          <div className="panel-head">
            <span className="p-icon">
              <Download size={20} />
            </span>
            <div>
              <h2>Data unlocked</h2>
              <p className="notice">
                Escrow is funded, so the dataset is available to download. Review it, then
                release payment to the seller.
              </p>
            </div>
          </div>
          <div className="spacer" />
          {downloadLink ? (
            <a className="dl-link" href={downloadLink} target="_blank" rel="noreferrer">
              {downloadLink}
            </a>
          ) : (
            <button className="secondary" onClick={getDownload}>
              <Download size={16} />
              Get download link
            </button>
          )}
          <div className="spacer" />
          <button onClick={confirm} disabled={busy}>
            <Check size={16} />
            {busy ? "Releasing…" : "Confirm & release payment"}
          </button>
        </div>
      )}

      {order.state === "RELEASED" && (
        <div className="card fade-in">
          <div className="panel-head ok">
            <span className="p-icon">
              <Check size={20} />
            </span>
            <div>
              <h2>Transaction complete</h2>
              <p className="notice">
                Payment has been released to the seller and the order is closed &mdash; your
                end-to-end proof that the escrow flow works.
              </p>
            </div>
          </div>
        </div>
      )}

      {err && (
        <p className="error">
          <Lock size={15} />
          {err}
        </p>
      )}

      <a className="back-link" href="/">
        <ArrowLeft size={16} />
        Back to search
      </a>
    </>
  );
}
