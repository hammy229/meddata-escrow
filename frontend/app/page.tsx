"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Match } from "@/lib/types";
import { LISTINGS, getListing } from "@/lib/listings";
import { ShieldCheck, Search, ArrowRight, Database, Lock } from "./icons";

const EXAMPLES = [
  "ICU vital-sign time series for a sepsis early-warning model",
  "Chest X-rays labeled for pneumonia detection",
  "Longitudinal diabetes records for outcome prediction",
];

export default function Home() {
  const [request, setRequest] = useState("");
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function search() {
    setLoading(true);
    setMatches(null);
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
      <span className="eyebrow">
        <ShieldCheck size={15} />
        PayPal-escrowed data marketplace
      </span>

      <h1>
        Find research data you can <span className="hl">actually trust.</span>
      </h1>
      <p className="sub">
        Describe your study in plain English. Our AI ranks matching datasets, and your
        payment stays in escrow until you&rsquo;ve confirmed the data is exactly what you
        expected.
      </p>

      <div className="instrument">
        <textarea
          aria-label="Describe the data your study needs"
          placeholder="e.g. I need ICU vital-sign time series for a sepsis early-warning model…"
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && request.trim()) search();
          }}
        />
        <div className="instrument-bar">
          <span className="instrument-hint">
            <Search size={15} />
            Ranked by relevance · {LISTINGS.length} datasets in catalog
          </span>
          <button onClick={search} disabled={loading || !request.trim()}>
            {loading ? "Matching…" : "Find datasets"}
            {!loading && <ArrowRight size={17} />}
          </button>
        </div>
      </div>

      {!matches && !loading && (
        <div className="chips">
          {EXAMPLES.map((ex) => (
            <button
              type="button"
              className="chip"
              key={ex}
              onClick={() => setRequest(ex)}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="card" style={{ marginTop: 28 }}>
          <div className="section-label">Ranking datasets</div>
          {[0, 1, 2].map((i) => (
            <div className="skel-row" key={i}>
              <div style={{ flex: 1 }}>
                <div className="skel" style={{ height: 16, width: "60%" }} />
                <div className="skel" style={{ height: 12, width: "80%", marginTop: 10 }} />
              </div>
              <div className="skel" style={{ height: 32, width: 88, marginLeft: 20 }} />
            </div>
          ))}
        </div>
      )}

      {matches && (
        <div className="card fade-in" style={{ marginTop: 28 }}>
          <div className="section-label">Ranked matches</div>

          {matches.length === 0 && (
            <div className="empty">
              <span className="e-icon">
                <Database size={22} />
              </span>
              <p className="notice">
                No datasets matched that description. Try different terms &mdash; or one of
                the examples above.
              </p>
            </div>
          )}

          <div className="ledger">
            {matches.map((m, i) => {
              const listing = getListing(m.listing_id);
              const pct = Math.max(6, Math.min(100, m.score));
              return (
                <div
                  className="match-row"
                  key={m.listing_id}
                  style={{ animationDelay: `${i * 70}ms` }}
                >
                  <div>
                    <div className="match-head">
                      <span className="match-icon">
                        <Database size={18} />
                      </span>
                      <div>
                        <div className="match-title">{listing?.title ?? m.listing_id}</div>
                        <div className="match-reason">{m.reason}</div>
                      </div>
                    </div>
                    {listing?.tags && (
                      <div className="match-tags">
                        {listing.tags.slice(0, 4).map((t) => (
                          <span className="tag" key={t}>
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="match-side">
                    <div className="relevance">
                      <span className="score">
                        <b>{m.score}</b>/100 match
                      </span>
                      <span className="meter">
                        <span style={{ width: `${pct}%` }} />
                      </span>
                    </div>
                    <div className="buy-row">
                      <span className="price">${listing?.price ?? "—"}</span>
                      <button onClick={() => buy(m.listing_id)}>
                        <Lock size={15} />
                        Buy via escrow
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
