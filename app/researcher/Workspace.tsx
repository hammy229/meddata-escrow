"use client";

// Researcher workspace (client component — interactive flow).
//
// Describe a study -> POST /api/match -> rank matches in a grid -> pick one ->
// "Buy (escrow)" authorizes payment via /api/orders -> drive the escrow arc
// (deliver -> capture -> payout, or void) -> ask a question -> POST /api/query
// returns a privacy-safe aggregate. All data comes from the Batch-A/B APIs;
// this file only calls them.
import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import MatchesGrid, {
  type Match,
  type MatchSource,
} from "../components/MatchesGrid";
import CompareMatches from "../components/CompareMatches";
import DisputePanel from "../components/DisputePanel";
import OrderReceipt from "../components/OrderReceipt";
import OrderTimeline from "../components/OrderTimeline";
import QueryResult, {
  type AggregateRow,
  type CompiledQuery,
} from "../components/QueryResult";
import SampleCheckCard, {
  type SampleCheck,
} from "../components/SampleCheckCard";
import QuerySpend from "../components/QuerySpend";
import { escrowRequest } from "../../lib/ui/escrow-response";
import { suggestQuestions } from "../../lib/query/suggestions";
import { MAX_COMPARE } from "../../lib/ui/compare";
import AgentRun from "../components/AgentRun";
import EscrowStepper from "../components/EscrowStepper";
import {
  describeHold,
  downloadLabel,
  type Delivery,
  orderToView,
  parseDelivery,
  shouldPoll,
  type EscrowFlowState,
} from "../../lib/ui/order-sync";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  Search,
  ShieldCheck,
} from "../components/icons";

type EscrowState = EscrowFlowState | null;

// What the page needs back after the buyer returns from the approval page.
const RESUME_KEY = "meddata:researcher-resume";

const POLL_MS = 4000;

// PATCH action -> the escrow state it advances to (for optimistic/degrade UI).
const ADVANCE: Record<string, Exclude<EscrowState, null>> = {
  deliver: "DELIVERED",
  capture: "CAPTURED",
  payout: "PAID_OUT",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
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

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default function ResearcherWorkspace({
  searchParams,
  initialStudy = "",
}: {
  initialStudy?: string;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = use(searchParams);
  const linkedOrderId = first(params.orderId);
  // PayPal appends `token` on a real return from the approval page.
  const returnToken = first(params.token);
  const returnCancelled = first(params.cancelled) === "1";
  const [description, setDescription] = useState(initialStudy);
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
  const [cancelled, setCancelled] = useState(false);
  // "Funds held · 28 days left · ..." from the order's authorization window.
  const [holdLine, setHoldLine] = useState<string | null>(null);
  // Expiring download link, present once the vendor has delivered.
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  // Query cap from a 402 (the receipt and billing carry their own copy).
  const [queryCap, setQueryCap] = useState<number | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [escrowNote, setEscrowNote] = useState<string | null>(null);
  // A real failure from the orders API, shown as is (never turned into success).
  const [escrowError, setEscrowError] = useState<string | null>(null);
  // True when the server handed back an order that was already open.
  const [reused, setReused] = useState(false);
  const [approveUrl, setApproveUrl] = useState<string | null>(null);
  // Bumped after every PATCH so the audit timeline refetches live.
  const [timelineKey, setTimelineKey] = useState(0);

  const [question, setQuestion] = useState("");
  const [querying, setQuerying] = useState(false);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [queryReasons, setQueryReasons] = useState<string[]>([]);
  // A safe rewording offered when the privacy guard refuses a question.
  const [querySuggestion, setQuerySuggestion] = useState<string | null>(null);
  // One-sentence answer shown above the result rows.
  const [summary, setSummary] = useState<string | null>(null);
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
    setCancelled(false);
    setHoldLine(null);
    setDelivery(null);
    setQueryCap(null);
    setOrderId(null);
    setEscrowNote(null);
    setEscrowError(null);
    setReused(false);
    setApproveUrl(null);
    setResults(null);
    setQueryError(null);
    setQueryReasons([]);
    setQuerySuggestion(null);
    setSummary(null);
    setCompiled(null);
  }

  // Show what the server says about an order. A status we do not know leaves
  // the screen as it is.
  function applyOrderStatus(status: string) {
    const view = orderToView(status);
    if (view.escrow === null) return;
    setEscrow((prev) => orderToView(status, prev).escrow ?? prev);
    setVoided(view.voided);
    setDisputed(view.disputed);
    setCancelled(view.cancelled);
  }

  // Poll the order while it can still change, so a vendor delivering,
  // resolving a dispute or a void shows up without a reload. Paused while one
  // of our own actions is in flight; its answer would race the poll.
  const watchedStatus = !orderId
    ? null
    : voided
      ? "VOIDED"
      : cancelled
        ? "CANCELLED"
        : disputed
          ? "DISPUTED"
          : escrow;
  const watching = shouldPoll(watchedStatus) && busyAction === null;
  // Last change the poll saw, so the audit trail refetches only when the
  // order actually moved.
  const lastPolledChange = useRef<string | null>(null);
  useEffect(() => {
    if (!orderId || !watching) return;
    let stale = false;
    async function tick() {
      try {
        const res = await fetch(
          `/api/orders?id=${encodeURIComponent(orderId!)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (stale || !res.ok || typeof data?.order?.status !== "string") return;
        applyOrderStatus(data.order.status);
        setHoldLine(describeHold(data.authorization));
        setDelivery(parseDelivery(data.delivery));
        const change = `${data.order.status}:${data.order.updated_at ?? ""}`;
        if (
          lastPolledChange.current !== null &&
          lastPolledChange.current !== change
        ) {
          setTimelineKey((k) => k + 1);
        }
        lastPolledChange.current = change;
      } catch {
        // Offline for a moment; the next tick tries again.
      }
    }
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stale = true;
      clearInterval(timer);
    };
  }, [orderId, watching, watchedStatus]);

  // Reopen an order from its link (?orderId=): the approval page, the agent's
  // order card and a copied URL all land here. Each order is handled once, so
  // a re-render never authorizes twice.
  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!linkedOrderId || handledLink.current === linkedOrderId) return;
    handledLink.current = linkedOrderId;
    (async () => {
      setEscrowError(null);
      try {
        const res = await fetch(
          `/api/orders?id=${encodeURIComponent(linkedOrderId)}`,
          { cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.order) {
          setEscrowError(
            data?.error ?? `Could not load order ${linkedOrderId}.`,
          );
          return;
        }
        let status: string = data.order.status;
        const datasetId: string = data.order.dataset_id;

        const dsRes = await fetch("/api/datasets", { cache: "no-store" });
        const dsData = await dsRes.json().catch(() => ({}));
        const ds = Array.isArray(dsData?.datasets)
          ? dsData.datasets.find((d: { id: string }) => d.id === datasetId)
          : null;
        setSelected({
          datasetId,
          score: 0,
          rationale: "",
          title: ds?.title ?? datasetId,
          priceCents:
            typeof ds?.priceCents === "number"
              ? ds.priceCents
              : data.order.amount_cents,
        });
        try {
          const saved = JSON.parse(
            sessionStorage.getItem(RESUME_KEY) ?? "null",
          );
          if (saved?.orderId === linkedOrderId) {
            if (typeof saved.description === "string")
              setDescription(saved.description);
            sessionStorage.removeItem(RESUME_KEY);
          }
        } catch {
          // No saved study text; the order itself is enough.
        }
        setOrderId(linkedOrderId);

        // Back from the approval page with the order still waiting on it.
        if (status === "MATCHED" && (returnToken || returnCancelled)) {
          const action = returnCancelled ? "cancel" : "authorize";
          const out = await escrowRequest("/api/orders", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ orderId: linkedOrderId, action }),
          });
          if (out.kind === "ok") {
            status = action === "cancel" ? "CANCELLED" : "AUTHORIZED";
          } else if (out.kind === "error") {
            setEscrowError(`Could not ${action} the order: ${out.message}`);
          }
        }
        applyOrderStatus(status);
        if (status === data.order.status) {
          setHoldLine(describeHold(data.authorization));
          setDelivery(parseDelivery(data.delivery));
        }
        if (status === "AUTHORIZED" && returnToken) {
          setEscrowNote("Approved. Funds are held in escrow.");
        } else if (status === "CANCELLED") {
          setEscrowNote("Order cancelled. Nothing was charged.");
        }
      } catch {
        setEscrowError("Could not reach the escrow service.");
      } finally {
        setTimelineKey((k) => k + 1);
      }
    })();
  }, [linkedOrderId, returnToken, returnCancelled]);

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

  // Buy = create the order, then send the buyer to the approval page. Funds are
  // only authorized after they approve there. A server error is shown as is and
  // nothing advances; only a request that never gets a response falls back to
  // the labelled offline demo.
  async function buyEscrow() {
    if (!selected) return;
    setBusyAction("buy");
    setEscrowNote(null);
    setEscrowError(null);
    setApproveUrl(null);
    setVoided(false);
    setDisputed(false);
    try {
      const created = await escrowRequest("/api/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          datasetId: selected.datasetId,
          amount: selected.priceCents / 100,
        }),
      });
      if (created.kind === "offline") {
        setEscrow("AUTHORIZED");
        setEscrowNote("Escrow authorize mocked for demo (service offline).");
        return;
      }
      if (created.kind === "error") {
        setEscrowError(`Could not open the order: ${created.message}`);
        return;
      }
      const data = created.data;
      if (typeof data.orderId !== "string") {
        setEscrowError("Could not open the order: no order id came back.");
        return;
      }
      setOrderId(data.orderId);
      setReused(data.reused === true);
      if (typeof data.approveUrl !== "string" || !data.approveUrl) {
        setEscrowError(
          "Could not open the approval page: no approve link came back.",
        );
        return;
      }
      // The buyer approves on the approval page (PayPal, or the local mock),
      // which sends them back to the workspace. Keep the study text so the
      // page can pick up where it left off.
      try {
        sessionStorage.setItem(
          RESUME_KEY,
          JSON.stringify({
            orderId: data.orderId,
            datasetId: selected.datasetId,
            description,
          }),
        );
      } catch {
        // Storage can be blocked; the order id in the return link is enough.
      }
      setEscrowNote("Opening the approval page…");
      window.location.assign(data.approveUrl);
      return;
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // Advance the escrow one step via PATCH (deliver / capture / payout).
  async function advanceEscrow(action: keyof typeof ADVANCE) {
    const nextState = ADVANCE[action];
    setBusyAction(action);
    setEscrowError(null);
    try {
      const out = await escrowRequest("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          orderId,
        }),
      });
      if (out.kind === "ok") {
        setEscrow(out.data.escrowState ?? nextState);
        if (out.data.mock) setEscrowNote(`${action} confirmed (mock mode).`);
        else setEscrowNote(null);
      } else if (out.kind === "error") {
        setEscrowError(`Could not ${action}: ${out.message}`);
      } else {
        setEscrow(nextState);
        setEscrowNote(`${action} mocked for demo (service offline).`);
      }
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // Cancel an order that was opened but never authorized (MATCHED -> CANCELLED).
  async function cancelOrder() {
    setBusyAction("cancel");
    setEscrowError(null);
    try {
      const out = await escrowRequest("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          orderId,
        }),
      });
      if (out.kind !== "ok") {
        setEscrowError(
          out.kind === "error"
            ? `Could not cancel the order: ${out.message}`
            : "Could not cancel the order: the service is offline.",
        );
        return;
      }
      // The cancelled order is closed; buying again opens a fresh one.
      setOrderId(null);
      setReused(false);
      setApproveUrl(null);
      setEscrowNote("Order cancelled. Nothing was charged.");
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // Void the authorization (sample failed) -> VOIDED, buyer not charged.
  async function voidEscrow() {
    setBusyAction("void");
    setEscrowError(null);
    try {
      const out = await escrowRequest("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "void",
          orderId,
        }),
      });
      if (out.kind === "error") {
        setEscrowError(`Could not void the authorization: ${out.message}`);
        return;
      }
      setVoided(true);
      setEscrowNote(
        out.kind === "ok"
          ? "Authorization voided — the buyer was not charged."
          : "Authorization voided for demo (service offline).",
      );
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // Raise a dispute (sample looks wrong) -> DISPUTED. It settles when the vendor
  // refunds the buyer, or when the buyer drops it and releases the payment.
  async function disputeEscrow() {
    setBusyAction("dispute");
    setEscrowError(null);
    try {
      const out = await escrowRequest("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "dispute",
          orderId,
        }),
      });
      if (out.kind === "error") {
        setEscrowError(`Could not raise the dispute: ${out.message}`);
        return;
      }
      setDisputed(true);
      setEscrowNote(
        out.kind === "ok"
          ? "Dispute raised. The vendor can refund you, or you can drop it and pay."
          : "Dispute raised for demo (service offline).",
      );
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // Drop our own dispute and release the held payment (DISPUTED -> CAPTURED).
  // Only the buyer can do this; the vendor's only move is a refund.
  async function dropDispute() {
    setBusyAction("resolve");
    setEscrowError(null);
    try {
      const out = await escrowRequest("/api/orders", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "resolve",
          resolution: "capture",
          orderId,
        }),
      });
      if (out.kind !== "ok") {
        setEscrowError(
          out.kind === "error"
            ? `Could not drop the dispute: ${out.message}`
            : "Could not drop the dispute: the service is offline.",
        );
        return;
      }
      setDisputed(false);
      setEscrow(out.data.escrowState ?? "CAPTURED");
      setEscrowNote("Dispute dropped. The payment was released to the vendor.");
    } finally {
      setBusyAction(null);
      setTimelineKey((k) => k + 1);
    }
  }

  // `asked` lets a suggested rewrite run without waiting for state to settle.
  async function runQuery(asked: string = question) {
    if (!selected || !asked.trim()) return;
    setQuerying(true);
    setQueryError(null);
    setQueryReasons([]);
    setQuerySuggestion(null);
    setSummary(null);
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
          question: asked,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 403 => privacy guard rejected the query (row-level/PII/small cell)
        // or the order does not grant data access; 404/422 => bad order.
        setQueryError(data?.error ?? `Query rejected (${res.status}).`);
        if (res.status === 402 && typeof data?.capCents === "number") {
          setQueryCap(data.capCents);
          setSpendKey((k) => k + 1);
        }
        setQueryReasons(Array.isArray(data?.reasons) ? data.reasons : []);
        if (typeof data?.suggestion === "string" && data.suggestion.trim()) {
          setQuerySuggestion(data.suggestion);
        }
        return;
      }
      // Show the SQL the vendor actually ran, plus how it was planned.
      const c = data.compiled;
      setCompiled(
        typeof c?.sql === "string"
          ? {
              sql: c.sql,
              execution: data.execution === "postgres" ? "postgres" : "mock",
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
      if (typeof data.summary === "string" && data.summary.trim()) {
        setSummary(data.summary);
      }
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
            the budget or your mandate, skip the sample check, or release any
            money.
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
                {escrow === "MATCHED" && !voided && !cancelled && !check && (
                  <button
                    onClick={runSampleCheck}
                    disabled={checking || busyAction !== null}
                    className={primaryBtn}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    {checking ? "Checking sample…" : "Check sample"}
                  </button>
                )}
                {escrow === "MATCHED" && !voided && !cancelled && orderId && (
                  <button
                    onClick={cancelOrder}
                    disabled={busyAction !== null}
                    className={dangerBtn}
                  >
                    {busyAction === "cancel" ? "Cancelling…" : "Cancel order"}
                  </button>
                )}
                {escrow === "MATCHED" && !voided && !cancelled && (
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
                      ? "Opening approval…"
                      : `${check && !check.passed ? "Buy anyway" : "Buy (escrow)"} · ${usd(selected.priceCents)}`}
                  </button>
                )}
                {escrow === "AUTHORIZED" && !voided && !disputed && (
                  <>
                    <p className="text-sm text-muted">
                      Waiting for the data provider to deliver your dataset.
                    </p>
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
                    Dispute open: the vendor can refund you
                  </span>
                )}
                {disputed && !voided && (
                  <button
                    onClick={dropDispute}
                    disabled={busyAction !== null}
                    className={primaryBtn}
                  >
                    {busyAction === "resolve"
                      ? "Releasing…"
                      : "Drop dispute & release payment"}
                  </button>
                )}
                {disputed && !voided && orderId && (
                  <DisputePanel orderId={orderId} role="researcher" />
                )}
                {escrow === "CAPTURED" && !disputed && (
                  <p className="text-sm text-muted">
                    Payment released. The provider can now collect their payout.
                  </p>
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
                cancelled={cancelled}
              />
            </div>
            {holdLine && !voided && !cancelled && (
              <p className="mt-3 inline-flex rounded-full border border-pp-300 bg-pp-50 px-3 py-1 font-mono text-xs text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300">
                {holdLine}
              </p>
            )}
            {escrowError && (
              <p
                role="alert"
                className="mt-4 inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
              >
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {escrowError}
              </p>
            )}
            {reused && (
              <p className="mt-2 text-xs text-muted">
                Reusing your open order for this dataset instead of creating a
                new one.
              </p>
            )}
            {escrowNote && (
              <p className="mt-4 text-sm text-muted">{escrowNote}</p>
            )}
            {/* Only useful while the buyer still has to approve; once funds
                are held the link would just offer a second approval. */}
            {approveUrl && escrow === "MATCHED" && !cancelled && (
              <a
                href={approveUrl}
                className="mt-2 inline-flex text-sm font-medium text-pp-700 hover:underline dark:text-pp-400"
              >
                Open PayPal approval →
              </a>
            )}
            {orderId && delivery && delivered && !voided && !disputed && (
              <p className="mt-4">
                <a
                  href={delivery.url}
                  download
                  className="inline-flex text-sm font-medium text-pp-700 underline underline-offset-4 dark:text-pp-400"
                >
                  {downloadLabel(delivery)}
                </a>
                {delivery.mock && (
                  <span className="ml-2 text-xs text-muted">demo file</span>
                )}
              </p>
            )}
            {orderId && (
              <OrderReceipt
                key={orderId}
                orderId={orderId}
                status={escrow}
                refreshKey={timelineKey}
              />
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
                onClick={() => runQuery()}
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
                {querySuggestion && (
                  <div className="mt-3 border-t border-amber-300/60 pt-3 dark:border-amber-500/30">
                    <p className="text-amber-800 dark:text-amber-300">
                      A safe way to ask this: &ldquo;{querySuggestion}&rdquo;
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setQuestion(querySuggestion);
                        runQuery(querySuggestion);
                      }}
                      disabled={querying}
                      className={`mt-2 ${secondaryBtn} !py-1.5`}
                    >
                      Try instead
                    </button>
                  </div>
                )}
              </div>
            )}

            {summary && (
              <p className="reveal mt-4 font-serif text-lg leading-snug">
                {summary}
              </p>
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
                  capCents={queryCap ?? undefined}
                />
              </div>
            )}
          </section>
        )}
      </main>
    </>
  );
}
