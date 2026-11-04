import { displayCount } from "./common";
import type { Finding } from "./types";

/**
 * Check whether the same subject appears in more than one split or cohort.
 * Only counts leave this function. A subject key is never copied into a finding.
 */
export function checkSubjectOverlap(splits: Record<string, readonly string[]>): Finding[] {
  const names = Object.keys(splits);
  const sets = names.map((n) => new Set(splits[n]));
  const findings: Finding[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      let shared = 0;
      for (const key of sets[i]) if (sets[j].has(key)) shared += 1;
      if (shared > 0) {
        findings.push({
          id: "subject_overlap",
          severity: "fail",
          title: `Subjects appear in both ${names[i]} and ${names[j]}`,
          reason: `${displayCount(shared)} subjects are present in both splits, so results measured on one are not independent of the other.`,
          metric: { shared: displayCount(shared), splitA: names[i], splitB: names[j] },
        });
      }
    }
  }
  if (findings.length === 0 && names.length > 1) {
    findings.push({
      id: "subject_overlap",
      severity: "pass",
      title: "No subjects shared across splits",
      reason: `No subject key appears in more than one of ${names.length} splits.`,
    });
  }
  return findings;
}

/** Flag a table that repeats a subject key when one row per subject is expected. */
export function checkSubjectUniqueness(keys: readonly string[]): Finding {
  const seen = new Set<string>();
  let repeats = 0;
  for (const k of keys) {
    if (seen.has(k)) repeats += 1;
    else seen.add(k);
  }
  if (repeats === 0) {
    return {
      id: "subject_overlap",
      severity: "pass",
      title: "One row per subject",
      reason: "Every subject key appears once.",
    };
  }
  return {
    id: "subject_overlap",
    severity: "fail",
    title: "Subjects repeat in a one-row-per-subject table",
    reason: `${displayCount(repeats)} rows repeat a subject key that already appeared, so the effective sample is smaller than the row count.`,
    metric: { repeatedRows: displayCount(repeats) },
  };
}
