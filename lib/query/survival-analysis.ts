// Privacy-safe survival analysis for SYNTHETIC fixture cohorts.
//
// A buyer picks one of a fixed list of groupings. There are no free-form
// filters, so two requests cannot be subtracted to isolate a person. What
// leaves is a Kaplan-Meier curve on a coarse grid, never an event time or a
// row:
//   - a group with fewer than MIN_CELL_SIZE people is withheld;
//   - a curve stops at the last grid point that still has MIN_CELL_SIZE people
//     at risk;
//   - at-risk counts are rounded to the nearest 5;
//   - a median is the first grid month at which the curve is at or under 0.5.
// The log-rank p-value is reported raw and, for the arm grouping, stratified
// by age band. Nothing here proves anything about a real disease: the data is
// invented.
import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { AlsCohort, AlsSubject } from "../synth/als";
import {
  kaplanMeier,
  logRank,
  survivalAt,
  type SurvivalObs,
} from "../stats/survival";

export const GROUP_BYS = ["arm", "sex", "onset_site", "age_band"] as const;
export type GroupBy = (typeof GROUP_BYS)[number];

/** Every 3 months out to 3 years. */
export const GRID_MONTHS: readonly number[] = Array.from({ length: 13 }, (_, i) => i * 3);

const ROUND_TO = 5;
export const SYNTHETIC_LABEL =
  "SYNTHETIC data. Invented for demos. Not from any real patient.";

export interface CurvePoint {
  month: number;
  /** Estimated share still alive, 0 to 1, three decimals. */
  survival: number;
  /** People still at risk, rounded to the nearest 5. */
  atRisk: number;
}

export interface SurvivalGroup {
  group: string;
  curve: CurvePoint[];
  /** First grid month at or under 0.5, or null if the shown curve never gets there. */
  medianMonths: number | null;
  /** Last month shown when the curve ended early for lack of people at risk. */
  truncatedAtMonth: number | null;
}

export interface PValue {
  chiSquare: number;
  df: number;
  pValue: number;
}

export interface SurvivalAnalysis {
  type: "survival";
  groupBy: GroupBy;
  synthetic: true;
  label: string;
  unit: "months";
  grid: number[];
  groups: SurvivalGroup[];
  /** Groups left out because they had fewer than MIN_CELL_SIZE people. */
  withheldGroups: number;
  logRank: {
    raw: { pValue: number | null; df: number | null };
    adjusted: { stratifiedBy: "age_band"; pValue: number; df: number } | null;
  };
  interpretation: string;
}

export type ParsedAnalysis =
  | { ok: true; groupBy: GroupBy }
  | { ok: false; error: string };

/** Accept only { type: "survival", groupBy: <allowlist> }. Any other key is refused. */
export function parseAnalysis(input: unknown): ParsedAnalysis {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, error: "analysis must be an object" };
  const o = input as Record<string, unknown>;
  const extra = Object.keys(o).filter((k) => k !== "type" && k !== "groupBy");
  if (extra.length)
    return {
      ok: false,
      error: "analysis takes only type and groupBy. Filters are not allowed.",
    };
  if (o.type !== "survival")
    return { ok: false, error: 'analysis.type must be "survival"' };
  if (typeof o.groupBy !== "string" || !GROUP_BYS.includes(o.groupBy as GroupBy))
    return {
      ok: false,
      error: `analysis.groupBy must be one of: ${GROUP_BYS.join(", ")}`,
    };
  return { ok: true, groupBy: o.groupBy as GroupBy };
}

export type SurvivalOutcome =
  | { kind: "ok"; analysis: SurvivalAnalysis }
  | { kind: "refused"; reason: string };

function keyOf(s: AlsSubject, by: GroupBy): string {
  return String(s[by]);
}

const roundRisk = (n: number) => Math.round(n / ROUND_TO) * ROUND_TO;

function curveFor(obs: readonly SurvivalObs[]): {
  curve: CurvePoint[];
  truncatedAtMonth: number | null;
  medianMonths: number | null;
} {
  const km = kaplanMeier(obs);
  const curve: CurvePoint[] = [];
  let truncatedAtMonth: number | null = null;
  for (const month of GRID_MONTHS) {
    const risk = obs.reduce((n, o) => n + (o.time >= month ? 1 : 0), 0);
    if (risk < MIN_CELL_SIZE) {
      truncatedAtMonth = curve.length ? curve[curve.length - 1].month : null;
      break;
    }
    curve.push({
      month,
      survival: Math.round(survivalAt(km, month) * 1000) / 1000,
      atRisk: roundRisk(risk),
    });
  }
  const med = curve.find((p) => p.survival <= 0.5);
  return { curve, truncatedAtMonth, medianMonths: med ? med.month : null };
}

const fmtP = (p: number) => (p < 0.001 ? "below 0.001" : p.toFixed(3));
const round4 = (p: number) => Math.round(p * 10000) / 10000;

function interpret(
  by: GroupBy,
  groups: number,
  raw: number | null,
  adjusted: number | null,
): string {
  const tail = " This is synthetic data and does not show cause.";
  if (raw === null)
    return `Only one group has enough people to show, so there is nothing to compare.${tail}`;
  if (by !== "arm" || adjusted === null)
    return raw < 0.05
      ? `The ${groups} groups differ in survival (log-rank p ${fmtP(raw)}). Nothing else is held fixed.${tail}`
      : `No clear difference between the ${groups} groups (log-rank p ${fmtP(raw)}). Nothing else is held fixed.${tail}`;
  if (raw < 0.05 && adjusted >= 0.05)
    return `The raw comparison shows a gap between the arms (p ${fmtP(raw)}), but the gap is not seen once age band is held fixed (p ${fmtP(adjusted)}). The arms have different age mixes, so the raw gap may come from age.${tail}`;
  if (raw < 0.05)
    return `The arms differ in survival (p ${fmtP(raw)}), and the difference is still there within age bands (p ${fmtP(adjusted)}).${tail}`;
  return `No clear difference between the arms, raw (p ${fmtP(raw)}) or within age bands (p ${fmtP(adjusted)}).${tail}`;
}

export function survivalAnalysis(cohort: AlsCohort, by: GroupBy): SurvivalOutcome {
  const buckets = new Map<string, AlsSubject[]>();
  for (const s of cohort.subjects) {
    const k = keyOf(s, by);
    const list = buckets.get(k) ?? [];
    list.push(s);
    buckets.set(k, list);
  }
  const keys = [...buckets.keys()].sort();
  const shown = keys.filter((k) => buckets.get(k)!.length >= MIN_CELL_SIZE);
  const withheldGroups = keys.length - shown.length;
  if (shown.length === 0)
    return {
      kind: "refused",
      reason: `No group has at least ${MIN_CELL_SIZE} people, so no curve can be shown.`,
    };

  const obsOf = (s: AlsSubject, strata: boolean): SurvivalObs => ({
    time: s.survival_months,
    event: s.died === 1,
    ...(strata && { stratum: s.age_band }),
  });

  const groups: SurvivalGroup[] = shown.map((k) => {
    const c = curveFor(buckets.get(k)!.map((s) => obsOf(s, false)));
    return { group: k, ...c };
  });

  let raw: PValue | null = null;
  let adjusted: PValue | null = null;
  if (shown.length >= 2) {
    const r = logRank(shown.map((k) => buckets.get(k)!.map((s) => obsOf(s, false))));
    raw = { chiSquare: r.chiSquare, df: r.df, pValue: r.pValue };
    if (by === "arm") {
      const a = logRank(shown.map((k) => buckets.get(k)!.map((s) => obsOf(s, true))));
      adjusted = { chiSquare: a.chiSquare, df: a.df, pValue: a.pValue };
    }
  }

  return {
    kind: "ok",
    analysis: {
      type: "survival",
      groupBy: by,
      synthetic: true,
      label: SYNTHETIC_LABEL,
      unit: "months",
      grid: [...GRID_MONTHS],
      groups,
      withheldGroups,
      logRank: {
        raw: raw ? { pValue: round4(raw.pValue), df: raw.df } : { pValue: null, df: null },
        adjusted: adjusted
          ? { stratifiedBy: "age_band", pValue: round4(adjusted.pValue), df: adjusted.df }
          : null,
      },
      interpretation: interpret(by, shown.length, raw?.pValue ?? null, adjusted?.pValue ?? null),
    },
  };
}
