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
import SiteNav from "../components/SiteNav";
import MatchesGrid, {
  type Match,
  type MatchSource,
} from "../components/MatchesGrid";
import CompareMatches from "../components/CompareMatches";
import OrderTimeline from "../components/OrderTimeline";
import QueryResult, {
  type AggregateRow,
  type CompiledQuery,
} from "../components/QueryResult";
import SampleCheckCard, {
  type SampleCheck,
} from "../components/SampleCheckCard";
import QuerySpend from "../components/QuerySpend";
import { suggestQuestions } from "../../lib/query/suggestions";
import { MAX_COMPARE } from "../../lib/ui/compare";
import AgentRun from "../components/AgentRun";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Search,
  ShieldCheck,
} from "../components/icons";

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
                  : "border-rule bg-paper text-zinc-400 dark:text-zinc-600",
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
  "inline-flex items-center gap-2 rounded-[3px] bg-ink px-5 py-2.5 text-sm text-paper transition-colors hover:bg-pp-600 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-ink";
const dangerBtn =
  "inline-flex items-center gap-2 rounded-[3px] border border-rose-300 px-5 py-2.5 text-sm text-rose-700 transition-colors hover:bg-rose-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10";

const secondaryBtn =
  "inline-flex items-center gap-2 rounded-[3px] border border-ink/25 px-5 py-2.5 text-sm text-ink transition-colors hover:border-ink active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";
const warnBtn =
  "inline-flex items-center gap-2 rounded-[3px] border border-amber-400 px-5 py-2.5 text-sm text-amber-800 transition-colors hover:bg-amber-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-500/50 dark:text-amber-300 dark:hover:bg-amber-500/10";

const sectionCard = "border-t border-rule pt-8 pb-10";
const inputBase =
  "w-full rounded-[3px] border border-ink/20 bg-paper px-4 py-3 text-sm outline-none transition-colors focus:border-pp-500 focus:ring-2 focus:ring-pp-500/15";
const stepBadge = "font-mono text-[0.7rem] tracking-[0.18em] text-muted";

export default function ResearcherPage() {
  const [description, setDescription] = useState("");
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [matchSource, setMatchSource] = useState<MatchSource>("keyword");
  const [selected, setSelected] = useState<Match | null>(null);
  // Rows ticked for side-by-side comparison; matchRun remounts the grid so
  // ticks never outlive the result list they came from.
  const [compare, setCompare] = useState<Match[]>([]);
  const [matchRun, setMatchRun] = useState(0);

  // Pre-purchase sample quality + privacy check for the selected match.
  // Tagged with its dataset so a late response for a previously selected
  // match is never shown against the current one.
  const [sampleCheck, setSampleCheck] = useState<
    (SampleCheck & { datasetId: string }) | null
  >(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

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
  const [compiled, setCompiled] = useState<CompiledQuery | null>(null);
  const [results, setResults] = useState<AggregateRow[] | null>(null);
  const [queryCharge, setQueryCharge] = useState<number | null>(null);
  // Bumped after every answered query so the spend tally refetches.
  const [spendKey, setSpendKey] = useState(0);

  function resetEscrow() {
    setSampleCheck(null);
    setCheckError(null);
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
    setCompare([]);
    setMatchRun((n) => n + 1);
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
      setMatchSource(data.source === "llm" ? "llm" : "keyword");
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

  // Check the vendor's sample against the study before paying. The verdict is
  // advisory: a failed check warns but never blocks the purchase.
  async function runSampleCheck() {
    if (!selected) return;
    const datasetId = selected.datasetId;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sampleCheck: datasetId,
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      const sc = data?.sampleCheck;
      if (!res.ok || !sc || typeof sc.passed !== "boolean") {
        setCheckError(data?.error ?? `Sample check failed (${res.status}).`);
        return;
      }
      setSampleCheck({
        datasetId,
        passed: sc.passed,
        score: typeof sc.score === "number" ? sc.score : 0,
        findings: Array.isArray(sc.findings) ? sc.findings : [],
        source: sc.source === "llm" ? "llm" : "rules",
      });
    } catch {
      setCheckError("Could not reach the sample check service.");
    } finally {
      setChecking(false);
    }
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
    setQueryCharge(null);
    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The server checks this order is paid + delivered for the dataset.
        body: JSON.stringify({
          orderId,
          datasetId: selected.datasetId,
          question,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 403 => privacy guard rejected the query (row-level/PII/small cell)
        // or the order does not grant data access; 404/422 => bad order.
        setQueryError(data?.error ?? `Query rejected (${res.status}).`);
        setQueryReasons(Array.isArray(data?.reasons) ? data.reasons : []);
        return;
      }
      // Show the SQL the vendor actually ran, plus how it was planned.
      const c = data.compiled;
      setCompiled(
        typeof c?.sql === "string"
          ? {
              sql: c.sql,
              plan:
                c.plan && typeof c.plan.op === "string" ? c.plan : undefined,
              explanation:
                typeof c.explanation === "string" ? c.explanation : undefined,
              source:
                c.source === "llm" || c.source === "keyword"
                  ? c.source
                  : undefined,
            }
          : null,
      );
      setResults(Array.isArray(data.result) ? data.result : []);
      // The server meters each answered query against the order.
      setQueryCharge(
        typeof data.usage?.chargeCents === "number"
          ? data.usage.chargeCents
          : null,
      );
      setSpendKey((k) => k + 1);
    } catch {
      setQueryError("Could not reach the query service.");
    } finally {
      setQuerying(false);
    }
  }

  const check =
    sampleCheck && selected && sampleCheck.datasetId === selected.datasetId
      ? sampleCheck
      : null;

  const delivered =
    escrow === "DELIVERED" || escrow === "CAPTURED" || escrow === "PAID_OUT";

  return (
    <>
      <SiteNav current="/researcher" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-10 lg:box-content lg:pl-[calc(72px+2.5rem)]">
        <div className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            MedData Escrow
          </Link>
          <h1 className="mt-6 font-serif text-[2.75rem] leading-tight font-normal">
            Researcher workspace
          </h1>
          <p className="mt-3 max-w-2xl font-light text-muted">
            Describe your study, compare ranked dataset matches, buy access with
            payment held in escrow, then run privacy-safe aggregate queries.
          </p>
        </div>

        {/* Step 1 — describe the study */}
        <section className={sectionCard}>
          <div className="flex items-baseline gap-4">
            <span className={stepBadge}>01</span>
            <h2 className="font-serif text-[1.6rem] font-normal">
              Describe your study
            </h2>
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

        {/* Shortcut — hand the whole search → check → order loop to the agent */}
        <section className={sectionCard}>
          <div className="flex items-baseline gap-4">
            <span className={stepBadge}>AI</span>
            <h2 className="font-serif text-[1.6rem] font-normal">
              Or let the agent buy it
            </h2>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            The agent searches, sample-checks and opens an escrow order within
            your budget. Guardrails are enforced in code: it can&apos;t exceed
            the budget, skip the sample check, or release any money.
          </p>
          <div className="mt-4">
            <AgentRun
              study={description}
              primaryBtn={secondaryBtn}
              inputBase={inputBase}
            />
          </div>
        </section>

        {/* Step 2 — ranked matches */}
        {matches.length > 0 && (
          <section className={sectionCard}>
            <div className="flex items-baseline gap-4">
              <span className={stepBadge}>02</span>
              <h2 className="font-serif text-[1.6rem] font-normal">
                Ranked matches
              </h2>
              <span className="text-sm text-muted">
                · click a row to select it, or tick up to {MAX_COMPARE} to
                compare
              </span>
            </div>
            <div className="mt-4">
              <MatchesGrid
                key={matchRun}
                matches={matches}
                source={matchSource}
                onSelect={selectMatch}
                onCompareChange={setCompare}
              />
              <CompareMatches
                picks={compare}
                onChoose={(id) => {
                  const m = compare.find((c) => c.datasetId === id);
                  if (m) selectMatch(m);
                }}
              />
            </div>
          </section>
        )}

        {/* Step 3 — escrow / buy + full lifecycle */}
        {selected && (
          <section className={sectionCard}>
            <div className="flex items-baseline gap-4">
              <span className={stepBadge}>03</span>
              <h2 className="font-serif text-[1.6rem] font-normal">Escrow</h2>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-medium">{selected.title}</p>
                <p className="text-sm text-muted">
                  {selected.datasetId} · {usd(selected.priceCents)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {escrow === "MATCHED" && !voided && !check && (
                  <button
                    onClick={runSampleCheck}
                    disabled={checking || busyAction !== null}
                    className={primaryBtn}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {checking ? "Checking sample…" : "Check sample"}
                  </button>
                )}
                {escrow === "MATCHED" && !voided && (
                  <button
                    onClick={buyEscrow}
                    disabled={busyAction !== null || checking}
                    className={
                      !check
                        ? secondaryBtn
                        : check.passed
                          ? primaryBtn
                          : warnBtn
                    }
                  >
                    {check && !check.passed && (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                    {busyAction === "buy"
                      ? "Authorizing…"
                      : `${check && !check.passed ? "Buy anyway" : "Buy (escrow)"} · ${usd(selected.priceCents)}`}
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
                      {busyAction === "dispute"
                        ? "Disputing…"
                        : "Raise dispute"}
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
                      {busyAction === "dispute"
                        ? "Disputing…"
                        : "Raise dispute"}
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
            {escrow === "MATCHED" && !check && !checkError && (
              <p className="mt-3 text-sm text-muted">
                Check the vendor&apos;s sample for quality and privacy issues
                before you pay.
              </p>
            )}
            {checkError && (
              <p
                role="alert"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {checkError}
              </p>
            )}
            {check && (
              <div className="mt-4">
                <SampleCheckCard
                  check={check}
                  warnBeforeBuy={escrow === "MATCHED"}
                />
              </div>
            )}
            <div className="mt-5">
              <EscrowStepper
                state={escrow}
                voided={voided}
                disputed={disputed}
              />
            </div>
            {escrowNote && (
              <p className="mt-4 text-sm text-muted">{escrowNote}</p>
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
              <div className="mt-6 border-t border-rule pt-5">
                <h3 className="mb-3 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                  Audit trail
                </h3>
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
          <section className={sectionCard}>
            <div className="flex items-baseline gap-4">
              <span className={stepBadge}>04</span>
              <h2 className="font-serif text-[1.6rem] font-normal">
                Run a privacy-safe query
              </h2>
            </div>
            <p className="mt-2 text-sm text-muted">
              Only aggregate questions are allowed. Row-level or PII requests,
              and small cells, are rejected by the privacy guard.
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

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Try:</span>
              {suggestQuestions(selected.datasetId).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setQuestion(q)}
                  className="rounded-full border border-rule bg-paper px-3 py-1 text-xs text-ink transition-colors hover:border-ink active:translate-y-px"
                >
                  {q}
                </button>
              ))}
            </div>

            {queryError && (
              <div className="mt-4 rounded-[3px] border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
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

            <QueryResult
              compiled={compiled}
              rows={results}
              fileStem={selected.datasetId}
            />
            {results && queryCharge !== null && (
              <p className="mt-2 text-xs text-muted">
                Billed {usd(queryCharge)} to this order.
              </p>
            )}

            {orderId && (
              <div className="mt-6 border-t border-rule pt-5">
                <h3 className="mb-3 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                  Query spend
                </h3>
                <QuerySpend
                  key={orderId}
                  orderId={orderId}
                  refreshKey={spendKey}
                />
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
