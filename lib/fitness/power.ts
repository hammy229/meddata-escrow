import { displayCount } from "./common";
import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { Finding } from "./types";

export const EPV_WARN_BELOW = 10;
export const EPV_FAIL_BELOW = 5;

/**
 * Events per variable. Warn below 10, fail below 5. When the event count is
 * under the cell floor the count and the ratio are left out of the report
 * (the ratio would give the count away), but the severity still reflects it.
 */
export function checkEventsPerVariable(events: number, variables: number): Finding {
  if (variables <= 0) {
    return {
      id: "epv",
      severity: "info",
      title: "No predictors to count",
      reason: "The study names no predictor columns, so events per variable does not apply.",
    };
  }
  const epv = events / variables;
  const hidden = events < MIN_CELL_SIZE;
  const metric: Record<string, number | string> = hidden
    ? { events: displayCount(events), variables }
    : { events, variables, epv: Math.round(epv * 10) / 10 };
  const shown = hidden ? `fewer than ${MIN_CELL_SIZE} events` : `${events} events`;
  if (epv < EPV_FAIL_BELOW) {
    return {
      id: "epv",
      severity: "fail",
      title: "Too few events for this many variables",
      reason: `${shown} across ${variables} variables is under ${EPV_FAIL_BELOW} events per variable, so a fitted model is likely to overfit.`,
      metric,
    };
  }
  if (epv < EPV_WARN_BELOW) {
    return {
      id: "epv",
      severity: "warn",
      title: "Few events for this many variables",
      reason: `${shown} across ${variables} variables is under ${EPV_WARN_BELOW} events per variable. Keep the model small.`,
      metric,
    };
  }
  return {
    id: "epv",
    severity: "pass",
    title: "Enough events for this many variables",
    reason: `${shown} across ${variables} variables is at least ${EPV_WARN_BELOW} events per variable.`,
    metric,
  };
}
