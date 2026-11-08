"use client";

// Guided story mode. A step rail on the left, the current step's caption and
// live results on the right. Start resets the mock database and autoplays the
// whole escrow arc through the real APIs (see app/demo/story.ts); Pause holds
// before the next step, Next runs one step by hand, Restart begins again.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  STEPS,
  StoryError,
  runStep,
  type Fact,
  type StepId,
  type StepOutcome,
  type StoryCtx,
} from "../demo/story";
import { AlertTriangle } from "./icons";
import SurvivalChart, { PValues } from "./SurvivalChart";

const GAP_MS = 2600;

type Mode = "idle" | "auto" | "paused" | "done" | "halted" | "error";

interface Done {
  facts: Fact[];
  link?: StepOutcome["link"];
  analysis?: StepOutcome["analysis"];
}

const apiFetch = (url: string, init?: RequestInit) =>
  fetch(
    url
      .replace("/api/demo/reset", "/api/demo/session/reset")
      .replace(/^\/api\/(match|orders|query)/, "/api/demo/session/$1"),
    init,
  );

function toneClass(t: Fact["tone"]): string {
  return t === "held"
    ? "text-pp-600 dark:text-pp-400"
    : t === "released"
      ? "text-emerald-700 dark:text-emerald-400"
      : "";
}

export default function GuidedDemo() {
  const [mock, setMock] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [next, setNext] = useState(0);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Partial<Record<StepId, Done>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const ctxRef = useRef<StoryCtx>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((j: { mode?: string }) => {
        if (!cancelled) setMock(j.mode === "mock");
      })
      .catch(() => {
        if (!cancelled) setMock(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async (index: number) => {
    const step = STEPS[index];
    setBusy(true);
    try {
      const out = await runStep(step.id, ctxRef.current, apiFetch);
      ctxRef.current = out.ctx;
      setResults((r) => ({
        ...r,
        [step.id]: {
          facts: out.facts,
          link: out.link,
          analysis: out.analysis,
        },
      }));
      setNext(index + 1);
      if (out.halt) {
        setMessage(out.halt);
        setMode("halted");
      } else if (index + 1 >= STEPS.length) {
        setMode("done");
      }
    } catch (err) {
      setMessage(
        err instanceof StoryError ? err.message : "Something went wrong.",
      );
      setMode("error");
    } finally {
      setBusy(false);
    }
  }, []);

  // Autoplay: run the next step after a short beat, so each caption can be read.
  useEffect(() => {
    if (mode !== "auto" || busy || next >= STEPS.length) return;
    const t = setTimeout(() => run(next), next === 0 ? 0 : GAP_MS);
    return () => clearTimeout(t);
  }, [mode, busy, next, run]);

  function start() {
    ctxRef.current = {};
    setResults({});
    setMessage(null);
    setNext(0);
    setMode("auto");
  }

  function stepOnce() {
    if (busy || next >= STEPS.length) return;
    setMode("paused");
    run(next);
  }

  // The step on screen: the one running (or failed), else the last finished.
  const shownIndex =
    busy || mode === "error"
      ? Math.min(next, STEPS.length - 1)
      : Math.max(0, next - 1);
  const shown = STEPS[shownIndex];
  const shownDone = results[shown.id];
  const playing = mode === "auto" || mode === "paused";
  const finished = mode === "done" || mode === "halted";

  const btn =
    "px-4 py-2 text-sm transition-opacity disabled:cursor-not-allowed disabled:opacity-40";
  const primary = `${btn} bg-ink text-paper hover:opacity-85`;
  const secondary = `${btn} border border-rule hover:border-ink`;
  // Tangerine is saved for the one action that starts the walkthrough.
  const cta = `${btn} bg-cta font-medium text-cta-ink hover:bg-cta-hover`;

  return (
    <div>
      <div
        role="status"
        className="mb-8 inline-flex items-center gap-2 border border-rule px-3 py-1.5 text-xs text-muted"
      >
        {mock === null ? (
          "Checking mode..."
        ) : mock ? (
          <>
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-muted" />
            Mock mode: PayPal calls are simulated and no real money moves. The
            app code, database and rules are real.
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5" />
            The guided demo resets the database, so it only runs in mock mode
            (PAYPAL_MODE=mock).
          </>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-[17rem_1fr]">
        <ol className="border-t border-rule" aria-label="Story steps">
          {STEPS.map((s, i) => {
            const done = i < next && !!results[s.id];
            const active = busy ? i === next : playing && i === next;
            return (
              <li
                key={s.id}
                aria-current={active ? "step" : undefined}
                className={`flex items-start gap-3 border-b border-rule py-3 ${
                  done || active ? "" : "text-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border font-mono text-[0.7rem] ${
                    done
                      ? "border-ink bg-ink text-paper"
                      : active
                        ? "border-pp-500 text-pp-600"
                        : "border-rule"
                  }`}
                >
                  {done ? "✓" : i + 1}
                </span>
                <span className="text-sm">
                  <span className={done || active ? "font-medium" : ""}>
                    {s.title}
                  </span>
                  <span className="sr-only">
                    {done ? ", done" : active ? ", running" : ", waiting"}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

        <div className="min-h-[22rem]">
          <div className="mb-6 flex flex-wrap gap-3">
            {!playing && !busy && (
              <button
                type="button"
                className={cta}
                onClick={start}
                disabled={mock !== true}
              >
                {finished || mode === "error" ? "Play again" : "Start the demo"}
              </button>
            )}
            {mode === "auto" && (
              <button
                type="button"
                className={secondary}
                onClick={() => setMode("paused")}
              >
                Pause
              </button>
            )}
            {mode === "paused" && (
              <button
                type="button"
                className={primary}
                onClick={() => setMode("auto")}
                disabled={busy}
              >
                Resume
              </button>
            )}
            {playing && (
              <button
                type="button"
                className={secondary}
                onClick={stepOnce}
                disabled={busy || next >= STEPS.length}
              >
                Next step
              </button>
            )}
            {(playing || finished) && (
              <button
                type="button"
                className={secondary}
                onClick={start}
                disabled={busy}
              >
                Restart
              </button>
            )}
          </div>

          {mode === "idle" ? (
            <div>
              <p className="font-serif text-2xl font-light">
                One order, from question to payout.
              </p>
              <p className="mt-3 max-w-xl text-sm font-light text-muted">
                Start resets the demo data, then plays twelve steps one after
                another. The first seven buy, deliver, query and pay for one
                dataset. The last five show a delivery failing its audit, the
                money staying held, and a survival chart on synthetic ALS data.
                Each step calls the live API and shows what it returned. Pause
                at any point, or step through by hand.
              </p>
            </div>
          ) : (
            <div aria-live="polite">
              <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                Step {STEPS.indexOf(shown) + 1} of {STEPS.length}
              </p>
              <h2 className="mt-2 font-serif text-3xl font-light">
                {shown.title}
              </h2>
              <p className="mt-3 max-w-xl font-light text-muted">
                {shown.caption}
              </p>

              {busy && !shownDone && (
                <p className="mt-6 text-sm text-muted" role="status">
                  Calling the API...
                </p>
              )}

              {shownDone && (
                <dl className="mt-6 max-w-xl border-t border-rule">
                  {shownDone.facts.map((f) => (
                    <div
                      key={f.label}
                      className="flex gap-4 border-b border-rule py-2.5 text-sm"
                    >
                      <dt className="w-32 shrink-0 font-mono text-[0.72rem] tracking-wide text-muted uppercase">
                        {f.label}
                      </dt>
                      <dd
                        className={`min-w-0 break-words ${toneClass(f.tone)}`}
                      >
                        {f.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}

              {shownDone?.analysis && (
                <div className="mt-8 max-w-2xl space-y-6">
                  <PValues analysis={shownDone.analysis} />
                  <SurvivalChart analysis={shownDone.analysis} />
                </div>
              )}

              {shownDone?.link && (
                <Link
                  href={shownDone.link.href}
                  className="mt-4 inline-block text-sm underline hover:text-pp-700"
                >
                  {shownDone.link.label}
                </Link>
              )}
            </div>
          )}

          {mode === "done" && (
            <p className="mt-8 max-w-xl border-t border-rule pt-4 text-sm font-light">
              The first order was paid out only after delivery. The curated
              delivery broke its listing, so its payment was held until a
              person decided, and the clean listing passed and was paid. The
              ALS data is synthetic, and the audit is a screen, not proof.{" "}
              <Link href="/insights" className="underline">
                Open Insights
              </Link>{" "}
              to see your account’s activity. This walkthrough uses isolated
              mock data and does not change your account totals.
            </p>
          )}
          {message && (mode === "halted" || mode === "error") && (
            <p
              role="alert"
              className="mt-8 inline-flex max-w-xl items-start gap-2 rounded-[3px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
