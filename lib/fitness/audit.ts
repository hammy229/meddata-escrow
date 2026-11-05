import { checkGroupBalance } from "./balance";
import { cell, displayCount, isMissing, verdictOf, type Row } from "./common";
import { checkCoverage, coveragePct } from "./coverage";
import { checkLeakImpact } from "./leak-impact";
import { checkLabelAssociation, checkTemporalLeak, type Timing } from "./leakage";
import { deriveNeeds } from "./needs";
import { checkEventsPerVariable } from "./power";
import { checkSubjectUniqueness } from "./subjects";
import type { Finding, FitnessReport, ListingClaims } from "./types";

export const DISCLAIMER =
  "This is a screen, not proof. It checks a few common problems in the rows it was given. " +
  "A pass does not show the data is fit for a study, and a flag can be a false alarm.";

export interface AuditInput {
  datasetId: string;
  stage: "sample" | "delivery";
  synthetic: boolean;
  /** Plain-text study description, used to decide which columns matter. */
  study: string;
  /** One row per subject. */
  subjects: readonly Row[];
  /** Visit-level rows, used only for the record count claim. */
  visits?: readonly Row[];
  /** 0/1 outcome column. Default "died". */
  label?: string;
  /** Follow-up time column, excluded from feature screens. Default "survival_months". */
  timeColumn?: string;
  /** Two-level comparison column. Default "arm". */
  groupColumn?: string;
  /** Subject identifier column. Default "subject_key". */
  idColumn?: string;
  /** When each column is known. Columns not listed are taken as known at index. */
  featureTiming?: Readonly<Record<string, Timing>>;
  landmarkMonth?: number;
  /** What the listing said about the data. Adds claim findings when present. */
  claims?: ListingClaims | null;
  /** Set false to skip the (slower) leak_impact model fits, e.g. in bulk evals. Default true. */
  leakImpact?: boolean;
}

function worse(a: number, warn: number, fail: number): "pass" | "warn" | "fail" {
  const d = Math.abs(a);
  return d > fail ? "fail" : d > warn ? "warn" : "pass";
}

function relDiff(claimed: number, seen: number): number {
  return claimed === 0 ? (seen === 0 ? 0 : 1) : Math.abs(seen - claimed) / claimed;
}

/** Compare what the listing said with what the rows show. */
export function checkClaims(
  claims: ListingClaims,
  seen: { subjects: number; records: number; eventRatePct: number; coverage: Record<string, number> },
  findings: readonly Finding[],
): Finding[] {
  const out: Finding[] = [];

  for (const [name, claimed, got] of [
    ["subjects", claims.subjects, seen.subjects],
    ["records", claims.records, seen.records],
  ] as const) {
    const sev = worse(relDiff(claimed, got) * 100, 2, 10);
    if (sev !== "pass") {
      out.push({
        id: "claim",
        severity: sev,
        title: `Listed ${name} do not match the delivered rows`,
        reason: `The listing says ${displayCount(claimed)} ${name}; the delivered rows show ${displayCount(got)}.`,
        metric: { claimed: displayCount(claimed), delivered: displayCount(got) },
      });
    }
  }

  const eventGap = Math.round(Math.abs(seen.eventRatePct - claims.eventRatePct) * 10) / 10;
  const eventSev = worse(eventGap, 2, 5);
  if (eventSev !== "pass") {
    out.push({
      id: "claim",
      severity: eventSev,
      title: "Event rate differs from the listing",
      reason: `The listing says ${claims.eventRatePct}% of subjects had the event; the delivered rows show ${seen.eventRatePct}%.`,
      metric: { claimedPct: claims.eventRatePct, deliveredPct: seen.eventRatePct },
    });
  }

  for (const [column, claimed] of Object.entries(claims.coveragePct)) {
    const got = seen.coverage[column];
    if (got === undefined) continue;
    if (claimed - got > 5) {
      out.push({
        id: "claim",
        severity: claimed - got > 15 ? "fail" : "warn",
        column,
        title: `${column} coverage is below the listing`,
        reason: `The listing says ${claimed}% of rows have ${column}; the delivered rows have ${got}%.`,
        metric: { claimedPct: claimed, deliveredPct: got },
      });
    }
  }

  if (claims.noPostIndexFeatures && findings.some((f) => f.id === "temporal_leak" && f.severity === "fail")) {
    out.push({
      id: "claim",
      severity: "fail",
      title: "Listing says no post-index features, but one is present",
      reason: "The listing promises that no feature is recorded after the index. The temporal screen found one.",
    });
  }
  if (claims.uniqueSubjects && findings.some((f) => f.id === "subject_overlap" && f.severity === "fail")) {
    out.push({
      id: "claim",
      severity: "fail",
      title: "Listing says one row per subject, but subjects repeat",
      reason: "The listing promises unique subjects. The delivered rows repeat at least one subject key.",
    });
  }

  if (out.length === 0) {
    out.push({
      id: "claim",
      severity: "pass",
      title: "Delivered rows match the listing",
      reason: "Subject count, record count, event rate and coverage agree with the listing within tolerance.",
    });
  }
  return out;
}

/** Run every screen and roll the findings up into one report. Sees only the rows given, never ids in output. */
export function runFitnessAudit(input: AuditInput): FitnessReport {
  const label = input.label ?? "died";
  const timeColumn = input.timeColumn ?? "survival_months";
  const groupColumn = input.groupColumn ?? "arm";
  const idColumn = input.idColumn ?? "subject_key";
  const base = {
    datasetId: input.datasetId,
    stage: input.stage,
    synthetic: input.synthetic,
    disclaimer: DISCLAIMER,
    methodVersion: 1 as const,
  };

  const first = input.subjects[0];
  if (!first || !(label in first)) {
    return {
      ...base,
      verdict: "not_applicable",
      findings: [
        {
          id: "coverage",
          severity: "info",
          title: "Nothing to screen",
          reason: `The table has no rows or no ${label} column, so the survival screens do not apply.`,
        },
      ],
    };
  }

  const columns = Object.keys(first);
  const features = columns.filter((c) => ![label, timeColumn, idColumn, groupColumn].includes(c));
  const needs = deriveNeeds(input.study, columns);
  const predictors = needs.needed.filter((c) => features.includes(c));
  const events = input.subjects.filter((r) => Number(cell(r, label)) === 1).length;

  const findings: Finding[] = [
    ...checkCoverage(input.subjects, needs),
    checkEventsPerVariable(events, predictors.length),
    checkSubjectUniqueness(input.subjects.map((r) => String(cell(r, idColumn)))),
    ...checkTemporalLeak(features, input.featureTiming ?? {}, input.landmarkMonth ?? 0),
    ...checkLabelAssociation(input.subjects, label, features),
    ...checkGroupBalance(input.subjects, groupColumn, features),
  ];

  // Evidence only: how much do the flagged columns inflate a model? Info severity.
  const flagged = findings
    .filter(
      (f) =>
        (f.id === "temporal_leak" || f.id === "label_association") &&
        (f.severity === "fail" || f.severity === "warn") &&
        f.column !== undefined &&
        features.includes(f.column),
    )
    .map((f) => f.column as string);
  const impact =
    input.leakImpact === false
      ? null
      : checkLeakImpact({
          subjects: input.subjects,
          label,
          timeColumn,
          features,
          flagged,
        });
  if (impact) findings.push(impact);

  if (input.claims) {
    const coverage: Record<string, number> = {};
    for (const column of Object.keys(input.claims.coveragePct)) coverage[column] = coveragePct(input.subjects, column);
    const keys = new Set(input.subjects.map((r) => String(cell(r, idColumn))).filter((k) => !isMissing(k)));
    findings.push(
      ...checkClaims(
        input.claims,
        {
          subjects: keys.size,
          records: (input.visits ?? input.subjects).length,
          eventRatePct: Math.round((events / input.subjects.length) * 1000) / 10,
          coverage,
        },
        findings,
      ),
    );
  }

  return { ...base, verdict: verdictOf(findings), findings };
}
