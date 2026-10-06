"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Match } from "@/lib/types";

const LISTING_META: Record<string, { title: string; price: string }> = {
  l1: { title: "De-identified ICU vitals, 10k patients", price: "250.00" },
  l2: { title: "Labeled chest X-ray imaging set", price: "500.00" },
  l3: { title: "Type 2 diabetes longitudinal cohort", price: "400.00" },
};

export default function Home() {
  const [request, setRequest] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function search() {
    setLoading(true);
    const r = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request }),
    });
    const data = await r.json();
    setMatches(data.matches);
    setLoading(false);
  }

  async function buy(listingId: string) {
    const r = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listing_id: listingId }),
    });
    const order = await r.json();
    router.push(`/orders/${order.order_id}`);
  }

  return (
    <>
      <h1>Find research data</h1>
      <p className="sub">
        Describe what your study needs. Our AI ranks matching datasets; payment is held in
        escrow until you confirm the data is what you expected.
      </p>

      <div className="card">
        <textarea
          placeholder="e.g. I need ICU vital sign time series for a sepsis early-warning model"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
        />
        <div className="spacer" />
        <button onClick={search} disabled={loading || !request.trim()}>
          {loading ? "Matching…" : "Find datasets"}
        </button>
      </div>

      {matches && (
        <div className="card">
          <h2>Ranked matches</h2>
          {matches.length === 0 && <p className="notice">No datasets matched. Try different terms.</p>}
          {matches.map((m) => {
            const meta = LISTING_META[m.listing_id];
            return (
              <div className="match-row" key={m.listing_id}>
                <div>
                  <div className="price">{meta?.title ?? m.listing_id}</div>
                  <div className="reason">{m.reason}</div>
                </div>
                <div className="row">
                  <span className="price">${meta?.price}</span>
                  <span className="score">{m.score}</span>
                  <button onClick={() => buy(m.listing_id)}>Buy via escrow</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
