"use client";

// Researcher workspace (client component — interactive flow).
//
// Describe a study -> POST /api/match -> rank matches in a grid -> pick one ->
// "Buy (escrow)" authorizes payment via /api/orders -> drive the escrow arc
// (deliver -> capture -> payout, or void) -> ask a question -> POST /api/query
// returns a privacy-safe aggregate. All data comes from the Batch-A/B APIs;
// this file only calls them.
import { useState } from "react";
import Link from "next/link";
import type { ColDef } from "ag-grid-community";
import DataGrid from "../components/DataGrid";

interface Match {
  datasetId: string;
  score: number;
  rationale: string;
  title: string;
  priceCents: number;
}

interface AggregateRow {
  group: string;
  count: number;
}

// The escrow lifecycle, in order. The UI advances through these as the flow
// progresses; VOIDED is a terminal off-ramp handled separately.
const ESCROW_FLOW = [
  "MATCHED",
  "AUTHORIZED",
  "DELIVERED",
  "CAPTURED",
  "PAID_OUT",
] as const;
type EscrowState = (typeof ESCROW_FLOW)[number] | null;

// PATCH action -> the escrow state it advances to (for optimistic/degrade UI).
const ADVANCE: Record<string, Exclude<EscrowState, null>> = {
  deliver: "DELIVERED",
  capture: "CAPTURED",
  payout: "PAID_OUT",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

const matchColumns: ColDef<Match>[] = [
  { field: "title", headerName: "Dataset", flex: 2, minWidth: 220 },
  {
    field: "score",
    headerName: "Match",
    maxWidth: 110,
    valueFormatter: (p) => (typeof p.value === "number" ? String(p.value) : ""),
  },
  { field: "rationale", headerName: "Why it matched", flex: 2, minWidth: 220 },
  {
    field: "priceCents",
    headerName: "Price",
    maxWidth: 120,
    valueFormatter: (p) => (typeof p.value === "number" ? usd(p.value) : ""),
  },
];

const resultColumns: ColDef<AggregateRow>[] = [
  { field: "group", headerName: "Group", flex: 2 },
  { field: "count", headerName: "Count", flex: 1, maxWidth: 160 },
];

function EscrowStepper({
  state,
  voided,
}: {
  state: EscrowState;
  voided: boolean;
}) {
  const activeIndex = state ? ESCROW_FLOW.indexOf(state) : -1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {ESCROW_FLOW.map((s, i) => {
        const reached = i <= activeIndex;
        const held = s === "AUTHORIZED" || s === "DELIVERED";
        return (
          <span
            key={s}
            className={[
              "rounded-full border px-3 py-1 font-mono text-xs transition-colors",
              reached && held
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                : reached
                  ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500"
                  : "border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600",
            ].join(" ")}
          >
            {s}
          </span>
        );
      })}
      {voided && (
        <span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 font-mono text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          VOIDED
        </span>
      )}
    </div>
  );
}

const primaryBtn =
  "rounded-full bg-emerald-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";
const dangerBtn =
  "rounded-full border border-rose-300 px-5 py-2 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10";

export default function ResearcherPage() {
  const [description, setDescription] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);

  const [escrow, setEscrow] = useState<EscrowState>(null);
  const [voided, setVoided] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [authorizationId, setAuthorizationId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [escrowNote, setEscrowNote] = useState<string | null>(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);

  const [question, setQuestion] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryReasons, setQueryReasons] = useState<string[]>([]);
  const [compiled, setCompiled] = useState<string | null>(null);
  const [results, setResults] = useState<AggregateRow[] | null>(null);

  function resetEscrow() {
    setEscrow(null);
    setVoided(false);
    setOrderId(null);
    setAuthorizationId(null);
    setEscrowNote(null);
    setApproveUrl(null);
    setResults(null);
    setQueryError(null);
    setQueryReasons([]);
    setCompiled(null);
  }

  async function runMatch() {
    if (!description.trim()) return;
    setMatching(true);
    setMatchError(null);
    setSelected(null);
    resetEscrow();
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMatchError(
          data?.error ??
            `Matching service responded ${res.status}. It may still be coming online.`,
        );
        setMatches([]);
        return;
      }
      setMatches(Array.isArray(data.matches) ? data.matches : []);
    } catch {
      setMatchError("Could not reach the matching service.");
      setMatches([]);
    } finally {
      setMatching(false);
    }
  }

  function selectMatch(m: Match) {
    setSelected(m);
    resetEscrow();
    setEscrow("MATCHED");
  }

  // Buy = create the order then authorize it, so the escrow reaches AUTHORIZED
  // (funds held). Falls back to an optimistic "mock" advance if the orders
  // service isn't wired yet (no PayPal creds), so the demo stays unblocked.
  async function buyEscrow() {
    if (!selected) return;
    setBusyAction("buy");
    setEscrowNote(null);
    setApproveUrl(null);
    setVoided(false);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetId: selected.datasetId,
          amount: selected.priceCents / 100,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.orderId !== "string") {
        setEscrow("AUTHORIZED");
        setEscrowNote(
          `Escrow authorize mocked for demo (${data?.error ?? res.status}).`,
        );
        return;
      }
      setOrderId(data.orderId);
      if (typeof data.approveUrl === "string") setApproveUrl(data.approveUrl);

      // Authorize the created order -> AUTHORIZED, returns the authorizationId.
      const auth = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "authorize",
          orderId: data.orderId,
          state: "MATCHED",
        }),
      });
      const adata = await auth.json().catch(() => ({}));
      if (auth.ok) {
        if (typeof adata.authorizationId === "string")
          setAuthorizationId(adata.authorizationId);
        setEscrow(adata.escrowState ?? "AUTHORIZED");
        const mock = data.mock || adata.mock ? " (mock mode)" : "";
        setEscrowNote(`Order ${data.orderId} authorized — funds held in escrow.${mock}`);
      } else {
        setEscrow("AUTHORIZED");
        setEscrowNote(
          `Escrow authorize mocked for demo (${adata?.error ?? auth.status}).`,
        );
      }
    } catch {
      setEscrow("AUTHORIZED");
      setEscrowNote("Escrow authorize mocked for demo (service offline).");
    } finally {
      setBusyAction(null);
    }
  }

  // Advance the escrow one step via PATCH (deliver / capture / payout).
  async function advanceEscrow(action: keyof typeof ADVANCE) {
    const nextState = ADVANCE[action];
    setBusyAction(action);
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          orderId,
          authorizationId,
          state: escrow,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEscrow(data.escrowState ?? nextState);
        if (data.mock) setEscrowNote(`${action} confirmed (mock mode).`);
        else setEscrowNote(null);
      } else {
        setEscrow(nextState);
        setEscrowNote(`${action} mocked for demo (${data?.error ?? res.status}).`);
      }
    } catch {
      setEscrow(nextState);
      setEscrowNote(`${action} mocked for demo (service offline).`);
    } finally {
      setBusyAction(null);
    }
  }

  // Void the authorization (sample failed) -> VOIDED, buyer not charged.
  async function voidEscrow() {
    setBusyAction("void");
    try {
      await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "void",
          orderId,
          authorizationId,
          state: escrow,
        }),
      }).catch(() => undefined);
    } finally {
      setVoided(true);
      setEscrowNote("Authorization voided — the buyer was not charged.");
      setBusyAction(null);
    }
  }

  async function runQuery() {
    if (!selected || !question.trim()) return;
    setQuerying(true);
    setQueryError(null);
    setQueryReasons([]);
    setCompiled(null);
    setResults(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId: selected.datasetId, question }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 403 => privacy guard rejected the query (row-level/PII/small cell).
        setQueryError(data?.error ?? `Query rejected (${res.status}).`);
        setQueryReasons(Array.isArray(data?.reasons) ? data.reasons : []);
        return;
      }
      setCompiled(typeof data.compiled === "string" ? data.compiled : null);
      setResults(Array.isArray(data.result) ? data.result : []);
    } catch {
      setQueryError("Could not reach the query service.");
    } finally {
      setQuerying(false);
    }
  }

  const delivered =
    escrow === "DELIVERED" || escrow === "CAPTURED" || escrow === "PAID_OUT";

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
      <div className="mb-8">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          ← MedData Escrow
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Researcher workspace
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Describe your study, compare ranked dataset matches, buy access with
          payment held in escrow, then run privacy-safe aggregate queries.
        </p>
      </div>

      {/* Step 1 — describe the study */}
      <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
            01
          </span>
          <h2 className="text-lg font-medium">Describe your study</h2>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Synthetic cardiology cohort with medications and observations for a readmission model."
          rows={4}
          className="mt-4 w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
        />
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={runMatch}
            disabled={matching || !description.trim()}
            className={primaryBtn}
          >
            {matching ? "Matching…" : "Find datasets"}
          </button>
          {matchError && (
            <span className="text-sm text-amber-600 dark:text-amber-400">
              {matchError}
            </span>
          )}
        </div>
      </section>

      {/* Step 2 — ranked matches */}
      {matches.length > 0 && (
        <section className="mt-6 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
              02
            </span>
            <h2 className="text-lg font-medium">Ranked matches</h2>
            <span className="text-sm text-zinc-500">· click a row to select</span>
          </div>
          <div className="mt-4">
            <DataGrid<Match>
              rowData={matches}
              columnDefs={matchColumns}
              getRowId={(r) => r.datasetId}
              selectedRowId={selected?.datasetId}
              onRowClicked={selectMatch}
              height={Math.min(80 + matches.length * 44, 360)}
            />
          </div>
        </section>
      )}

      {/* Step 3 — escrow / buy + full lifecycle */}
      {selected && (
        <section className="mt-6 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
              03
            </span>
            <h2 className="text-lg font-medium">Escrow</h2>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-medium">{selected.title}</p>
              <p className="text-sm text-zinc-500">
                {selected.datasetId} · {usd(selected.priceCents)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {escrow === "MATCHED" && !voided && (
                <button
                  onClick={buyEscrow}
                  disabled={busyAction !== null}
                  className={primaryBtn}
                >
                  {busyAction === "buy"
                    ? "Authorizing…"
                    : `Buy (escrow) · ${usd(selected.priceCents)}`}
                </button>
              )}
              {escrow === "AUTHORIZED" && !voided && (
                <>
                  <button
                    onClick={() => advanceEscrow("deliver")}
                    disabled={busyAction !== null}
                    className={primaryBtn}
                  >
                    {busyAction === "deliver" ? "Delivering…" : "Deliver dataset"}
                  </button>
                  <button
                    onClick={voidEscrow}
                    disabled={busyAction !== null}
                    className={dangerBtn}
                  >
                    {busyAction === "void" ? "Voiding…" : "Void (sample failed)"}
                  </button>
                </>
              )}
              {escrow === "DELIVERED" && (
                <button
                  onClick={() => advanceEscrow("capture")}
                  disabled={busyAction !== null}
                  className={primaryBtn}
                >
                  {busyAction === "capture"
                    ? "Releasing…"
                    : "Confirm & release payment"}
                </button>
              )}
              {escrow === "CAPTURED" && (
                <button
                  onClick={() => advanceEscrow("payout")}
                  disabled={busyAction !== null}
                  className={primaryBtn}
                >
                  {busyAction === "payout" ? "Paying out…" : "Pay out vendor"}
                </button>
              )}
              {escrow === "PAID_OUT" && (
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
                  ✓ Vendor paid out
                </span>
              )}
            </div>
          </div>
          <div className="mt-5">
            <EscrowStepper state={escrow} voided={voided} />
          </div>
          {escrowNote && <p className="mt-4 text-sm text-zinc-500">{escrowNote}</p>}
          {approveUrl && (
            <a
              href={approveUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-400"
            >
              Open PayPal approval →
            </a>
          )}
        </section>
      )}

      {/* Step 4 — privacy-safe query (available once the dataset is delivered) */}
      {selected && delivered && !voided && (
        <section className="mt-6 rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
              04
            </span>
            <h2 className="text-lg font-medium">Run a privacy-safe query</h2>
          </div>
          <p className="mt-2 text-sm text-zinc-500">
            Only aggregate questions are allowed. Row-level or PII requests, and
            small cells, are rejected by the privacy guard.
          </p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runQuery();
              }}
              placeholder="e.g. Count of patients by condition"
              className="flex-1 rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-sm outline-none transition-colors focus:border-emerald-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              onClick={runQuery}
              disabled={querying || !question.trim()}
              className={primaryBtn}
            >
              {querying ? "Querying…" : "Run query"}
            </button>
          </div>

          {queryError && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
              <p className="font-medium text-amber-800 dark:text-amber-300">
                {queryError}
              </p>
              {queryReasons.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-amber-700 dark:text-amber-400">
                  {queryReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {compiled && (
            <pre className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50 p-4 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
              {compiled}
            </pre>
          )}

          {results && (
            <div className="mt-4">
              <DataGrid<AggregateRow>
                rowData={results}
                columnDefs={resultColumns}
                height={Math.min(80 + results.length * 44, 360)}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
