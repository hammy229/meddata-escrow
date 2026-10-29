// Shareable replay of one procurement agent run (server component). Reads the
// stored run from the audit table and shows what the agent did, which
// guardrails held, the shortlist and the recommendation. Read-only: nothing
// here can reopen or change an order.
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "../../components/SiteNav";
import { SourceBadge } from "../../components/MatchesGrid";
import { ArrowLeft, Check, AlertTriangle } from "../../components/icons";
import { buildReplay } from "../../../lib/agent/replay";
import { getAgentRun } from "../../../lib/agent/store";

// Runs are created at request time, so this page can never be prerendered.
export const dynamic = "force-dynamic";

const section = "border-t border-rule pt-8 pb-10";
const eyebrow =
  "font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase";

function usd(cents: number | null): string {
  return cents === null ? "n/a" : `$${(cents / 100).toFixed(2)}`;
}

const SAMPLE_LABELS = {
  passed: "Passed",
  failed: "Failed",
  not_run: "Not run",
};

export default async function AgentReplayPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const stored = getAgentRun(runId);
  if (!stored) notFound();
  const replay = buildReplay(stored);

  return (
    <>
      <SiteNav current="/researcher" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-10 lg:box-content lg:pl-[calc(72px+2.5rem)]">
        <div className="mb-12">
          <Link
            href="/researcher"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Researcher workspace
          </Link>
          <h1 className="mt-6 font-serif text-[2.75rem] leading-tight font-normal">
            Agent run replay
          </h1>
          <p className="mt-3 max-w-2xl font-light text-muted">{replay.study}</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SourceBadge
              ai={replay.source === "llm"}
              aiLabel="Planned by Claude"
              fallbackLabel="Scripted planner"
            />
            <span className="font-mono text-xs text-zinc-400">
              {replay.runId}
            </span>
            <span className="text-sm text-muted">
              Budget {usd(replay.budgetCents)} · {replay.createdAt}
            </span>
          </div>
        </div>

        <section className={section}>
          <h2 className="mb-4 font-serif text-[1.6rem] font-normal">
            Recommendation
          </h2>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium">
              {replay.recommendation.title ??
                replay.recommendation.datasetId ??
                "Nothing within the guardrails"}
            </span>
            {replay.recommendation.reasoning &&
              ` — ${replay.recommendation.reasoning}`}
          </p>
          {replay.orderId && (
            <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-pp-800 dark:text-pp-300">
              <Check className="h-4 w-4" />
              Escrow order {replay.orderId} opened. Nothing is charged until the
              buyer approves it in PayPal.
            </p>
          )}
        </section>

        <section className={section}>
          <h2 className="mb-4 font-serif text-[1.6rem] font-normal">Steps</h2>
          <ol className="space-y-2">
            {replay.steps.map((s) => (
              <li
                key={s.n}
                className={
                  s.refused
                    ? "rounded-lg border border-amber-300 bg-amber-50/70 px-3 py-2 text-sm dark:border-amber-500/40 dark:bg-amber-500/10"
                    : "rounded-lg border border-rule px-3 py-2 text-sm"
                }
              >
                <div className="flex items-center gap-2 font-medium">
                  <span className="font-mono text-xs text-zinc-400">
                    {String(s.n).padStart(2, "0")}
                  </span>
                  {s.label}
                </div>
                <p className="mt-0.5 text-muted">{s.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={section}>
          <h2 className="mb-4 font-serif text-[1.6rem] font-normal">
            Guardrails
          </h2>
          <ul className="space-y-2 text-sm">
            {replay.guardrails.map((g) => (
              <li key={g.label} className="flex gap-3">
                {g.status === "triggered" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                ) : (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-pp-700 dark:text-pp-400" />
                )}
                <span>
                  <span className="font-medium">{g.label}</span>
                  {g.status === "triggered" && (
                    <span className="text-amber-700 dark:text-amber-400">
                      {" "}
                      (refused a call)
                    </span>
                  )}
                  <span className="block text-muted">{g.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {replay.shortlist.length > 0 && (
          <section className={section}>
            <h2 className="mb-4 font-serif text-[1.6rem] font-normal">
              Shortlist
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className={eyebrow}>
                    <th className="py-2 pr-4 font-normal">Dataset</th>
                    <th className="py-2 pr-4 font-normal">Price</th>
                    <th className="py-2 pr-4 font-normal">Fit</th>
                    <th className="py-2 pr-4 font-normal">Sample</th>
                    <th className="py-2 pr-4 font-normal">In budget</th>
                    <th className="py-2 font-normal">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {replay.shortlist.map((i) => (
                    <tr key={i.datasetId} className="border-t border-rule">
                      <td className="py-2.5 pr-4">
                        <span className={i.chosen ? "font-medium" : ""}>
                          {i.chosen && "✓ "}
                          {i.title ?? i.datasetId}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        {usd(i.priceCents)}
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        {i.fitScore ?? "n/a"}
                      </td>
                      <td className="py-2.5 pr-4">
                        {SAMPLE_LABELS[i.sampleCheck]}
                      </td>
                      <td className="py-2.5 pr-4">
                        {i.withinBudget === null
                          ? "n/a"
                          : i.withinBudget
                            ? "Yes"
                            : "No"}
                      </td>
                      <td className="py-2.5 text-muted">{i.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
