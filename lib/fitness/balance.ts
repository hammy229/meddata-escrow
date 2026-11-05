import { cell, displayCount, isMissing, type Row } from "./common";
import type { Finding } from "./types";

export const SMD_WARN_AT = 0.1;
export const SMD_FAIL_AT = 0.25;

function mean(xs: readonly number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function variance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1);
}

/** Standardized mean difference for a numeric column: (m1 - m0) / sqrt((s1^2 + s0^2) / 2). */
export function smdNumeric(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const pooled = Math.sqrt((variance(a) + variance(b)) / 2);
  return pooled === 0 ? 0 : (mean(b) - mean(a)) / pooled;
}

/** Standardized difference for a 0/1 column: (p1 - p0) / sqrt((p1(1-p1) + p0(1-p0)) / 2). */
export function smdBinary(a: readonly number[], b: readonly number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const pa = mean(a);
  const pb = mean(b);
  const pooled = Math.sqrt((pa * (1 - pa) + pb * (1 - pb)) / 2);
  return pooled === 0 ? 0 : (pb - pa) / pooled;
}

function isBinary(xs: readonly number[]): boolean {
  return xs.every((x) => x === 0 || x === 1);
}

/**
 * Largest absolute SMD for a column between two groups. Numbers use the
 * numeric form (or the binary form for 0/1 columns); text columns are split
 * into one-vs-rest indicators and the worst level is kept.
 */
function columnSmd(
  rows0: readonly Row[],
  rows1: readonly Row[],
  column: string,
): { smd: number; se: number } | null {
  const v0 = rows0.map((r) => cell(r, column)).filter((v) => !isMissing(v));
  const v1 = rows1.map((r) => cell(r, column)).filter((v) => !isMissing(v));
  if (v0.length === 0 || v1.length === 0) return null;
  const all = [...v0, ...v1];
  const withSe = (smd: number) => ({
    smd,
    se: smdStdError(smd, v0.length, v1.length),
  });
  if (all.every((v) => typeof v === "number" || typeof v === "boolean")) {
    const a = v0.map(Number);
    const b = v1.map(Number);
    return withSe(
      Math.abs(isBinary([...a, ...b]) ? smdBinary(a, b) : smdNumeric(a, b)),
    );
  }
  const levels = [...new Set(all.map(String))];
  let worst = 0;
  for (const level of levels) {
    const a = v0.map((v) => (String(v) === level ? 1 : 0));
    const b = v1.map((v) => (String(v) === level ? 1 : 0));
    worst = Math.max(worst, Math.abs(smdBinary(a, b)));
  }
  return withSe(worst);
}

/** Large-sample standard error of a standardized mean difference between groups of size n0 and n1. */
export function smdStdError(smd: number, n0: number, n1: number): number {
  return Math.sqrt((n0 + n1) / (n0 * n1) + (smd * smd) / (2 * (n0 + n1)));
}

/**
 * How many standard errors an SMD must exceed to count as imbalance when the
 * audit asks for the noise gate. In a small clean sample, chance alone gives
 * SMDs well over 0.1 (the standard error is about 0.2 at 100 subjects), so a
 * bare threshold fires on nearly every small cohort. 2.58 is the two-sided 1%
 * point of the normal curve. Added after the audit eval measured that false
 * alarm rate; see evals/results/audit.json.
 */
export const SMD_NOISE_Z = 2.58;

export interface BalanceOptions {
  /** Require smd >= noiseZ * standard error as well as the band. Default 0 (band only). */
  noiseZ?: number;
}

/**
 * Group imbalance screen. Compares each feature between the two levels of
 * `groupColumn`. Warn from 0.1, fail from 0.25 (absolute SMD). A big SMD on a
 * variable tied to the outcome means a raw group comparison is confounded.
 */
export function checkGroupBalance(
  rows: readonly Row[],
  groupColumn: string,
  features: readonly string[],
  options: BalanceOptions = {},
): Finding[] {
  const noiseZ = options.noiseZ ?? 0;
  const levels = [
    ...new Set(
      rows
        .map((r) => cell(r, groupColumn))
        .filter((v) => !isMissing(v))
        .map(String),
    ),
  ].sort();
  if (levels.length !== 2) {
    return [
      {
        id: "imbalance",
        severity: "info",
        column: groupColumn,
        title: "Group balance not checked",
        reason: `${groupColumn} has ${levels.length} levels, and the balance screen needs exactly 2.`,
      },
    ];
  }
  const g0 = rows.filter((r) => String(cell(r, groupColumn)) === levels[0]);
  const g1 = rows.filter((r) => String(cell(r, groupColumn)) === levels[1]);
  const findings: Finding[] = [];
  const round2 = (x: number) => Math.round(x * 100) / 100;
  const gateNote =
    noiseZ > 0 ? ` and above sampling noise, ${noiseZ} standard errors` : "";
  for (const column of features) {
    if (column === groupColumn) continue;
    const got = columnSmd(g0, g1, column);
    if (got === null) continue;
    const { smd, se } = got;
    // Within sampling noise: the band is not enough on its own.
    if (smd < noiseZ * se) continue;
    const rounded = Math.round(smd * 1000) / 1000;
    const metric = {
      smd: rounded,
      groupA: displayCount(g0.length),
      groupB: displayCount(g1.length),
    };
    if (smd >= SMD_FAIL_AT) {
      findings.push({
        id: "imbalance",
        severity: "fail",
        column,
        title: `${column} differs a lot between groups`,
        reason: `The standardized difference in ${column} is ${rounded} (fail from ${SMD_FAIL_AT}${gateNote}). A raw comparison of the groups is confounded unless ${column} is held fixed.`,
        metric,
      });
    } else if (smd >= SMD_WARN_AT) {
      findings.push({
        id: "imbalance",
        severity: "warn",
        column,
        title: `${column} differs somewhat between groups`,
        reason: `The standardized difference in ${column} is ${rounded} (warn from ${SMD_WARN_AT}${gateNote}).`,
        metric,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "imbalance",
      severity: "pass",
      title: "Groups are balanced on the checked features",
      reason:
        noiseZ > 0
          ? `No checked feature has a standardized difference that is both over ${SMD_WARN_AT} and above sampling noise (${noiseZ} standard errors). In small groups the noise gate, not ${SMD_FAIL_AT}, is the effective cutoff: about ${round2(noiseZ * smdStdError(0, g0.length, g1.length))} at these group sizes.`
          : `Every checked feature has a standardized difference under ${SMD_WARN_AT} between the groups.`,
    });
  }
  return findings;
}
