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
import OrderTimeline from "../components/OrderTimeline";
import { ArrowLeft, Check, AlertTriangle, Search } from "../components/icons";

interface Match {
  datasetId: string;
  score: number;
  rationale: string;
  title: string;
  priceCents: number;
}

// One aggregate result row: `{ group, count }`, `{ group, avg_age }`, or a
// single scalar like `{ avg_bmi }` — the keys follow the compiled query.
type AggregateRow = Record<string, string | number>;

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

// Result columns follow the returned row's keys, so a grouped average shows
// its mean column instead of an empty "Count".
function resultColumns(rows: AggregateRow[]): ColDef<AggregateRow>[] {
  return Object.keys(rows[0] ?? {}).map((field) =>
    field === "group"
      ? { field, headerName: "Group", flex: 2 }
      : { field, headerName: field, flex: 1, maxWidth: 160 },
  );
}

function EscrowStepper({
  state,
  voided,
  disputed,
}: {
  state: EscrowState;
  voided: boolean;
  disputed: boolean;
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
                ? "border-pp-300 bg-pp-50 text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300"
                : reached
                  ? "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500"
                  : "border-zinc-200 bg-white text-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-600",
            ].join(" ")}
          >
            {s}
          </span>
        );
      })}
      {disputed && (
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 font-mono text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          DISPUTED
        </span>
      )}
      {voided && (
        <span className="rounded-full border border-rose-300 bg-rose-50 px-3 py-1 font-mono text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          VOIDED
        </span>
      )}
    </div>
  );
}

const primaryBtn =
  "inline-flex items-center gap-2 rounded-full bg-pp-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm shadow-pp-600/30 transition-all hover:bg-pp-500 hover:shadow-md hover:shadow-pp-600/30 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none";
const dangerBtn =
  "inline-flex items-center gap-2 rounded-full border border-rose-300 px-5 py-2.5 text-sm font-medium text-rose-700 transition-all hover:bg-rose-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10";

const sectionCard =
  "rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900/40 dark:shadow-black/20";
const inputBase =
  "w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-pp-500 focus:ring-4 focus:ring-pp-500/15 dark:border-zinc-700 dark:bg-zinc-950";
const stepBadge =
  "grid h-7 w-7 place-items-center rounded-lg bg-pp-50 font-mono text-xs font-semibold text-pp-700 dark:bg-pp-500/10 dark:text-pp-400";

export default function ResearcherPage() {
  const [description, setDescription] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);

  const [escrow, setEscrow] = useState<EscrowState>(null);
  const [voided, setVoided] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [escrowNote, setEscrowNote] = useState<string | null>(null);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  // Bumped after every PATCH so the audit timeline refetches live.
  const [timelineKey, setTimelineKey] = useState(0);

  const [question, setQuestion] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryReasons, setQueryReasons] = useState<string[]>([]);
  const [compiled, setCompiled] = useState<string | null>(null);
  const [results, setResults] = useState<AggregateRow[] | null>(null);

  function resetEscrow() {
    setEscrow(null);
    setVoided(false);
    setDisputed(false);
    setOrderId(null);
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
    setDisputed(false);
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

      // Authorize the created order -> AUTHORIZED. The server derives the `from`
      // state and PayPal ids from the stored row, so we only send orderId.
      const auth = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "authorize",
          orderId: data.orderId,
        }),
      });
      const adata = await auth.json().catch(() => ({}));
      if (auth.ok) {
        setEscrow(adata.escrowState ?? "AUTHORIZED");
        const mock = data.mock || adata.mock ? " (mock mode)" : "";
        setEscrowNote(
          `Order ${data.orderId} authorized — funds held in escrow.${mock}`,
        );
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
      setTimelineKey((k) => k + 1);
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
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setEscrow(data.escrowState ?? nextState);
        if (data.mock) setEscrowNote(`${action} confirmed (mock mode).`);
        else setEscrowNote(null);
      } else {
        setEscrow(nextState);
        setEscrowNote(
          `${action} mocked for demo (${data?.error ?? res.status}).`,
        );
      }
    } catch {
      setEscrow(nextState);
      setEscrowNote(`${action} mocked for demo (service offline).`);
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
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
        }),
      }).catch(() => undefined);
    } finally {
      setVoided(true);
      setEscrowNote("Authorization voided — the buyer was not charged.");
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // Raise a dispute (sample looks wrong) -> DISPUTED. The vendor then resolves it
  // from their workspace: capture (release to vendor) or void (refund buyer).
  async function disputeEscrow() {
    setBusyAction("dispute");
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "dispute",
          orderId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setDisputed(true);
      setEscrowNote(
        res.ok
          ? "Dispute raised — awaiting resolution in the vendor workspace."
          : `Dispute raised for demo (${data?.error ?? res.status}).`,
      );
    } catch {
      setDisputed(true);
      setEscrowNote("Dispute raised for demo (service offline).");
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
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
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          MedData Escrow
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Researcher workspace
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Describe your study, compare ranked dataset matches, buy access with
          payment held in escrow, then run privacy-safe aggregate queries.
        </p>
      </div>

      {/* Step 1 — describe the study */}
      <section className={sectionCard}>
        <div className="flex items-center gap-2.5">
          <span className={stepBadge}>01</span>
          <h2 className="text-lg font-semibold">Describe your study</h2>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Synthetic cardiology cohort with medications and observations for a readmission model."
          rows={4}
          className={`mt-4 resize-y ${inputBase}`}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={runMatch}
            disabled={matching || !description.trim()}
            className={primaryBtn}
          >
            <Search className="h-4 w-4" />
            {matching ? "Matching…" : "Find datasets"}
          </button>
          {matchError && (
            <span className="inline-flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              {matchError}
            </span>
          )}
        </div>
      </section>

      {/* Step 2 — ranked matches */}
      {matches.length > 0 && (
        <section className={`mt-6 ${sectionCard}`}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>02</span>
            <h2 className="text-lg font-semibold">Ranked matches</h2>
            <span className="text-sm text-zinc-500">
              · click a row to select
            </span>
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
        <section className={`mt-6 ${sectionCard}`}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>03</span>
            <h2 className="text-lg font-semibold">Escrow</h2>
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
              {escrow === "AUTHORIZED" && !voided && !disputed && (
                <>
                  <button
                    onClick={() => advanceEscrow("deliver")}
                    disabled={busyAction !== null}
                    className={primaryBtn}
                  >
                    {busyAction === "deliver"
                      ? "Delivering…"
                      : "Deliver dataset"}
                  </button>
                  <button
                    onClick={disputeEscrow}
                    disabled={busyAction !== null}
                    className={dangerBtn}
                  >
                    {busyAction === "dispute" ? "Disputing…" : "Raise dispute"}
                  </button>
                  <button
                    onClick={voidEscrow}
                    disabled={busyAction !== null}
                    className={dangerBtn}
                  >
                    {busyAction === "void"
                      ? "Voiding…"
                      : "Void (sample failed)"}
                  </button>
                </>
              )}
              {escrow === "DELIVERED" && !disputed && (
                <>
                  <button
                    onClick={() => advanceEscrow("capture")}
                    disabled={busyAction !== null}
                    className={primaryBtn}
                  >
                    {busyAction === "capture"
                      ? "Releasing…"
                      : "Confirm & release payment"}
                  </button>
                  <button
                    onClick={disputeEscrow}
                    disabled={busyAction !== null}
                    className={dangerBtn}
                  >
                    {busyAction === "dispute" ? "Disputing…" : "Raise dispute"}
                  </button>
                </>
              )}
              {disputed && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4" />
                  Dispute pending vendor resolution
                </span>
              )}
              {escrow === "CAPTURED" && !disputed && (
                <button
                  onClick={() => advanceEscrow("payout")}
                  disabled={busyAction !== null}
                  className={primaryBtn}
                >
                  {busyAction === "payout" ? "Paying out…" : "Pay out vendor"}
                </button>
              )}
              {escrow === "PAID_OUT" && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-pp-300 bg-pp-50 px-4 py-2 text-sm font-medium text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300">
                  <Check className="h-4 w-4" />
                  Vendor paid out
                </span>
              )}
            </div>
          </div>
          <div className="mt-5">
            <EscrowStepper state={escrow} voided={voided} disputed={disputed} />
          </div>
          {escrowNote && (
            <p className="mt-4 text-sm text-zinc-500">{escrowNote}</p>
          )}
          {approveUrl && (
            <a
              href={approveUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex text-sm font-medium text-pp-700 hover:underline dark:text-pp-400"
            >
              Open PayPal approval →
            </a>
          )}
          {orderId && (
            <div className="mt-6 border-t border-zinc-200 pt-5 dark:border-zinc-800">
              <h3 className="mb-3 text-sm font-semibold">Audit trail</h3>
              <OrderTimeline
                key={orderId}
                orderId={orderId}
                refreshKey={timelineKey}
              />
            </div>
          )}
        </section>
      )}

      {/* Step 4 — privacy-safe query (available once the dataset is delivered) */}
      {selected && delivered && !voided && !disputed && (
        <section className={`mt-6 ${sectionCard}`}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>04</span>
            <h2 className="text-lg font-semibold">Run a privacy-safe query</h2>
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
              className={`flex-1 ${inputBase} py-2.5`}
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
              <p className="inline-flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0" />
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
                columnDefs={resultColumns(results)}
                height={Math.min(80 + results.length * 44, 360)}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
