import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { FitnessReport, Finding } from "./types";

/** Any plain object works as a row, including typed interfaces. */
export type Row = object;

export function cell(row: Row, column: string): unknown {
  return (row as Record<string, unknown>)[column];
}

/** Render a count for a report. Anything under the cell floor is not shown. */
export function displayCount(n: number): number | string {
  return n < MIN_CELL_SIZE ? `fewer than ${MIN_CELL_SIZE}` : n;
}

/** Worst severity wins. Info and pass findings never lower the verdict. */
export function verdictOf(findings: readonly Finding[]): FitnessReport["verdict"] {
  if (findings.some((f) => f.severity === "fail")) return "fail";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "pass";
}

export function isMissing(v: unknown): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}
