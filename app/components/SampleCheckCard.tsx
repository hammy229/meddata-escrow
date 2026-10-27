"use client";

// Result of the pre-purchase sample quality + privacy check
// (POST /api/match { sampleCheck, description }). Shows the verdict, the
// 0-100 score, every finding, and which reviewer produced it. The verdict is
// carried by text and an icon, with color only as reinforcement.
import { SourceBadge } from "./MatchesGrid";
import { AlertTriangle, Check } from "./icons";

export interface SampleCheck {
  passed: boolean;
  score: number;
  findings: string[];
  source: "llm" | "rules";
}

export default function SampleCheckCard({
  check,
  warnBeforeBuy,
}: {
  check: SampleCheck;
  /** Show the "you can still buy" warning (only before the order exists). */
  warnBeforeBuy: boolean;
}) {
  const tone = check.passed
    ? "border-pp-200 bg-pp-50/60 dark:border-pp-500/30 dark:bg-pp-500/5"
    : "border-amber-300 bg-amber-50/70 dark:border-amber-500/40 dark:bg-amber-500/10";
  return (
    <div className={`reveal rounded-[3px] border p-4 ${tone}`} role="status">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={
            check.passed
              ? "inline-flex items-center gap-1.5 text-sm font-semibold text-pp-800 dark:text-pp-300"
              : "inline-flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-300"
          }
        >
          {check.passed ? (
            <Check className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          Sample check {check.passed ? "passed" : "failed"}
        </span>
        <span className="font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
          {check.score}
          <span className="text-zinc-400">/100</span>
        </span>
        <SourceBadge
          ai={check.source === "llm"}
          aiLabel="Reviewed by Claude"
          fallbackLabel="Rule-based check"
        />
      </div>
      {check.findings.length > 0 && (
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-muted">
          {check.findings.map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
      {!check.passed && warnBeforeBuy && (
        <p className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-300">
          This sample did not pass. You can still buy: payment is only held in
          escrow, and you can void or dispute before it is released.
        </p>
      )}
    </div>
  );
}
