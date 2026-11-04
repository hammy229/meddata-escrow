import { cell, displayCount, isMissing, type Row } from "./common";
import type { Finding } from "./types";

export const AUC_WARN_AT = 0.9;
export const AUC_FAIL_AT = 0.95;

/** When a column is known: a month after index, or "followup" (derived from follow-up). */
export type Timing = number | "followup";

/**
 * Temporal screen. A feature recorded after the index or landmark time cannot
 * be known when a prediction is made, so it leaks the future into the model.
 * Columns missing from `timing` are assumed to be known at index.
 */
export function checkTemporalLeak(
  features: readonly string[],
  timing: Readonly<Record<string, Timing>>,
  landmarkMonth = 0,
): Finding[] {
  const findings: Finding[] = [];
  for (const column of features) {
    const t = timing[column];
    if (t === undefined) continue;
    const late = t === "followup" || t > landmarkMonth;
    if (!late) continue;
    findings.push({
      id: "temporal_leak",
      severity: "fail",
      column,
      title: `${column} is recorded after the index`,
      reason:
        t === "followup"
          ? `${column} is derived from follow-up, so it is not known at the index time. A model that uses it sees the future.`
          : `${column} is recorded at month ${t}, after the landmark at month ${landmarkMonth}. A model that uses it sees the future.`,
      metric: { recordedAt: t, landmarkMonth },
    });
  }
  if (findings.length === 0) {
    findings.push({
      id: "temporal_leak",
      severity: "pass",
      title: "No feature is recorded after the index",
      reason: "No checked feature is marked as recorded after the index or landmark time.",
    });
  }
  return findings;
}

/** Mann-Whitney AUC of `values` for label 1, ties counted half. Null if a class is empty. */
export function rankAuc(values: readonly number[], labels: readonly number[]): number | null {
  const n = values.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a] - values[b]);
  const rank = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) rank[order[k]] = avg;
    i = j + 1;
  }
  let pos = 0;
  let rankSum = 0;
  for (let k = 0; k < n; k += 1) {
    if (labels[k] === 1) {
      pos += 1;
      rankSum += rank[k];
    }
  }
  const neg = n - pos;
  if (pos === 0 || neg === 0) return null;
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

function asNumber(v: unknown): number | null {
  if (isMissing(v)) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Association screen. A single feature that separates the label almost
 * perfectly is more often a leak than a discovery. Orientation is ignored, so
 * an AUC of 0.03 counts the same as 0.97. Warn from 0.90, fail from 0.95.
 */
export function checkLabelAssociation(rows: readonly Row[], label: string, features: readonly string[]): Finding[] {
  const findings: Finding[] = [];
  for (const column of features) {
    const values: number[] = [];
    const labels: number[] = [];
    for (const r of rows) {
      const v = asNumber(cell(r, column));
      const y = asNumber(cell(r, label));
      if (v === null || y === null) continue;
      values.push(v);
      labels.push(y);
    }
    // Skip text columns and columns with no usable pairs.
    if (values.length === 0) continue;
    const raw = rankAuc(values, labels);
    if (raw === null) continue;
    const auc = Math.max(raw, 1 - raw);
    const rounded = Math.round(auc * 1000) / 1000;
    const metric = { auc: rounded, rows: displayCount(values.length) };
    if (auc >= AUC_FAIL_AT) {
      findings.push({
        id: "label_association",
        severity: "fail",
        column,
        title: `${column} almost perfectly separates the outcome`,
        reason: `Alone, ${column} ranks the outcome with an AUC of ${rounded} (fail from ${AUC_FAIL_AT}). That usually means the column is computed from the outcome.`,
        metric,
      });
    } else if (auc >= AUC_WARN_AT) {
      findings.push({
        id: "label_association",
        severity: "warn",
        column,
        title: `${column} is very strongly tied to the outcome`,
        reason: `Alone, ${column} ranks the outcome with an AUC of ${rounded} (warn from ${AUC_WARN_AT}). Check how the column was built.`,
        metric,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "label_association",
      severity: "pass",
      title: "No single feature gives away the outcome",
      reason: `No checked numeric feature reaches an AUC of ${AUC_WARN_AT} against the outcome on its own.`,
    });
  }
  return findings;
}
