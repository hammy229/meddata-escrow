"use client";

// The fitness screen, shown generically. A finding is drawn from its title,
// reason and metric only, never from its id, so a new kind of finding shows up
// without a code change here. The same card serves the sample-stage screen
// (POST /api/match { fitnessCheck }) and the stored delivery audit
// (GET /api/orders?id=&audit=1). It is a screen, not proof, and says so.
import { useEffect, useState, type ReactNode } from "react";
import type { DeliveryAudit, Finding, FitnessReport } from "../../lib/fitness/types";
import { AlertTriangle, Check } from "./icons";

const ORDER: Record<string, number> = { fail: 0, warn: 1, info: 2, pass: 3 };

const SEVERITY_WORD: Record<string, string> = {
  fail: "Problem",
  warn: "Warning",
  info: "Note",
  pass: "OK",
};

function humanize(key: string): string {
  return key.replace(/_/g, " ");
}

function MetricList({ metric }: { metric: NonNullable<Finding["metric"]> }) {
  const entries = Object.entries(metric);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-muted">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt>{humanize(k)}</dt>
          <dd className="text-ink">{String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const bad = finding.severity === "fail";
  const warn = finding.severity === "warn";
  return (
    <li className="border-t border-rule py-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span
          className={`font-mono text-[0.65rem] tracking-[0.14em] uppercase ${
            bad
              ? "text-rose-700 dark:text-rose-300"
              : warn
                ? "text-amber-800 dark:text-amber-300"
                : "text-muted"
          }`}
        >
          {SEVERITY_WORD[finding.severity] ?? finding.severity}
        </span>
        <span className="text-sm font-medium">{finding.title}</span>
        {finding.column && (
          <span className="font-mono text-xs text-muted">{finding.column}</span>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{finding.reason}</p>
      {finding.metric && <MetricList metric={finding.metric} />}
    </li>
  );
}

const VERDICT_TEXT: Record<string, string> = {
  pass: "No problems found",
  warn: "Warnings found",
  fail: "Problems found",
  inconclusive: "No verdict",
  not_applicable: "Not screened",
};

/** The report body. `children` is for a note placed under the verdict. */
export default function FitnessAuditCard({
  heading,
  report,
  verdict,
  children,
}: {
  heading: string;
  report: FitnessReport | null;
  /** Overrides the report's verdict (the stored audit can be "inconclusive"). */
  verdict?: string;
  children?: ReactNode;
}) {
  const v = verdict ?? report?.verdict ?? "not_applicable";
  const bad = v === "fail";
  const warn = v === "warn" || v === "inconclusive";
  const tone = bad
    ? "border-rose-300 dark:border-rose-500/40"
    : warn
      ? "border-amber-300 dark:border-amber-500/40"
      : "border-rule";
  const findings = [...(report?.findings ?? [])].sort(
    (a, b) => (ORDER[a.severity] ?? 9) - (ORDER[b.severity] ?? 9),
  );
  return (
    <section
      aria-label={heading}
      className={`reveal rounded-[3px] border p-4 ${tone}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
          {heading}
        </h3>
        {report?.synthetic && (
          <span className="rounded-[3px] border border-ink/30 px-1.5 py-0.5 font-mono text-[0.65rem] tracking-[0.14em]">
            SYNTHETIC
          </span>
        )}
      </div>
      <p
        className={`mt-2 inline-flex items-center gap-1.5 text-sm font-semibold ${
          bad
            ? "text-rose-700 dark:text-rose-300"
            : warn
              ? "text-amber-800 dark:text-amber-300"
              : ""
        }`}
      >
        {v === "pass" ? (
          <Check className="h-4 w-4" />
        ) : (
          <AlertTriangle className="h-4 w-4" />
        )}
        {VERDICT_TEXT[v] ?? v}
      </p>
      {children}
      {findings.length > 0 && (
        <ul className="mt-3">
          {findings.map((f, i) => (
            <FindingRow key={`${f.id}-${f.column ?? ""}-${i}`} finding={f} />
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">
        {report?.disclaimer ??
          "This is a screen, not proof. A pass does not show the data is fit for a study."}
      </p>
    </section>
  );
}

/** The sample-stage screen: fetched by the workspace, shown here. */
export function SampleFitnessCard({ report }: { report: FitnessReport }) {
  return (
    <FitnessAuditCard heading="Fitness screen of the sample" report={report}>
      <p className="mt-1 text-sm text-muted">
        This screens the sample rows for study problems such as missing
        columns, leaks and uneven groups. Listing claims are checked when the
        data is delivered.
      </p>
    </FitnessAuditCard>
  );
}

/** Plain words for what the audit means for the money. */
export function heldReason(
  audit: Pick<DeliveryAudit, "verdict" | "blocking">,
  role: "researcher" | "vendor",
): string | null {
  if (audit.blocking)
    return role === "vendor"
      ? "The money is held. The delivered data breaks a claim your listing made. The buyer or an arbiter decides next. Nothing is released automatically."
      : "Your payment stays held. The delivered data breaks a claim the listing made. A person decides what happens next. Nothing is released automatically.";
  if (audit.verdict === "inconclusive")
    return "The audit could not reach a verdict, so the payment is not released automatically. A person decides.";
  if (audit.verdict === "warn")
    return "The audit found warnings. Warnings do not hold payment on their own.";
  return null;
}

/**
 * The stored delivery audit for an order. Renders nothing when the listing was
 * not audited. `status` is the order's status, so the audit is read again once
 * delivery has happened.
 */
export function DeliveryAuditPanel({
  orderId,
  role,
  status,
}: {
  orderId: string;
  role: "researcher" | "vendor";
  status: string | null;
}) {
  const [audit, setAudit] = useState<DeliveryAudit | null>(null);
  useEffect(() => {
    let stale = false;
    fetch(`/api/orders?id=${encodeURIComponent(orderId)}&audit=1`, {
      cache: "no-store",
    })
      .then((r) => r.json().catch(() => null))
      .then((d) => {
        if (!stale) setAudit(d?.audit ?? null);
      })
      .catch(() => {
        if (!stale) setAudit(null);
      });
    return () => {
      stale = true;
    };
  }, [orderId, status]);
  if (!audit) return null;
  const reason = heldReason(audit, role);
  return (
    <FitnessAuditCard
      heading="Delivery audit"
      report={audit.report}
      verdict={audit.verdict}
    >
      {reason && (
        <p
          className={`mt-1 text-sm ${audit.blocking ? "font-medium" : "text-muted"}`}
        >
          {reason}
        </p>
      )}
      {audit.fingerprint && (
        <p className="mt-1 font-mono text-xs text-muted">
          Rows audited: {audit.fingerprint.slice(0, 12)}. This shows which rows
          were checked, nothing more.
        </p>
      )}
    </FitnessAuditCard>
  );
}
