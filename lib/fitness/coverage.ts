import { cell, displayCount, isMissing, type Row } from "./common";
import type { Needs } from "./needs";
import type { Finding } from "./types";

/** Share of rows with a value, as a percent with one decimal. */
export function coveragePct(rows: readonly Row[], column: string): number {
  if (rows.length === 0) return 0;
  const present = rows.filter((r) => !isMissing(cell(r, column))).length;
  return Math.round((present / rows.length) * 1000) / 10;
}

export const COVERAGE_WARN_BELOW = 80;
export const COVERAGE_FAIL_BELOW = 50;

/**
 * Coverage thresholds apply only to the columns the study needs. A sparse
 * column the study does not use is reported as info and never lowers the verdict.
 */
export function checkCoverage(rows: readonly Row[], needs: Needs): Finding[] {
  if (rows.length === 0) {
    return [
      {
        id: "coverage",
        severity: "fail",
        title: "No rows to check",
        reason: "The table has no rows, so coverage cannot be measured.",
      },
    ];
  }
  const findings: Finding[] = [];
  for (const column of needs.needed) {
    const pct = coveragePct(rows, column);
    const metric = { coveragePct: pct, rows: displayCount(rows.length) };
    if (pct < COVERAGE_FAIL_BELOW) {
      findings.push({
        id: "coverage",
        severity: "fail",
        column,
        title: `${column} is mostly missing`,
        reason: `The study needs ${column}, but only ${pct}% of rows have a value (fail below ${COVERAGE_FAIL_BELOW}%).`,
        metric,
      });
    } else if (pct < COVERAGE_WARN_BELOW) {
      findings.push({
        id: "coverage",
        severity: "warn",
        column,
        title: `${column} has gaps`,
        reason: `The study needs ${column}, and ${pct}% of rows have a value (warn below ${COVERAGE_WARN_BELOW}%).`,
        metric,
      });
    } else {
      findings.push({
        id: "coverage",
        severity: "pass",
        column,
        title: `${column} is well covered`,
        reason: `${pct}% of rows have a value for ${column}.`,
        metric,
      });
    }
  }
  for (const column of needs.notNeeded) {
    const pct = coveragePct(rows, column);
    if (pct < COVERAGE_FAIL_BELOW) {
      findings.push({
        id: "coverage",
        severity: "info",
        column,
        title: `${column} is sparse but not needed`,
        reason: `Only ${pct}% of rows have ${column}. The study does not appear to use it, so this does not affect the verdict.`,
        metric: { coveragePct: pct, rows: displayCount(rows.length) },
      });
    }
  }
  return findings;
}
