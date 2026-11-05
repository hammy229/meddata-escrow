// Measure the fitness audit on planted flaws. SYNTHETIC: the cohorts come from
// lib/synth/als and every flaw is injected here, by post-processing clean rows,
// at a graded strength. Each flaw is planted alone so a miss or a false alarm
// can be pinned on one check. Same seeds, same output, on every machine.
//
// What it answers, per check and per cohort size:
//   - sensitivity: how often the check flags a planted flaw, by strength
//   - false alarm rate: how often it flags clean data
//   - FALSE BLOCK rate: how often clean data, with a listing that tells the
//     truth, would have had money held up (a failed claim finding)
//
// Limits are written into the result under `limitations`.
import { smdNumeric } from "../fitness/balance";
import { runFitnessAudit } from "../fitness/audit";
import { checkDrift } from "../fitness/drift";
import { rankAuc } from "../fitness/leakage";
import { LEAK_GAP, measureLeakImpact } from "../fitness/leak-impact";
import type { FitnessReport, ListingClaims } from "../fitness/types";
import { generateAlsCohort, type AlsCohort, type AlsVisit } from "../synth/als";
import { createRng, type Rng } from "../synth/prng";
import {
  mean,
  median,
  normalCdf,
  round,
  wilson,
  type Proportion,
} from "./stats";

export const CHECK_IDS = [
  "coverage",
  "epv",
  "subject_overlap",
  "temporal_leak",
  "label_association",
  "imbalance",
  "claim",
] as const;
export type CheckId = (typeof CHECK_IDS)[number];

type Row = Record<string, unknown>;
const STUDY = "Predict survival from baseline FVC and age at onset";

export interface Planted {
  subjects: Row[];
  visits: readonly AlsVisit[];
  claims: ListingClaims | null;
  featureTiming?: Record<string, "followup">;
  /** Extra number worth reporting, e.g. the measured age SMD. */
  note?: number;
}

export interface Condition {
  id: string;
  family: "clean" | "leak" | "missing" | "duplicates" | "imbalance" | "claim";
  /** The check that is supposed to notice this flaw. */
  check: CheckId;
  label: string;
  level: number;
  plant(
    base: AlsCohort,
    honest: ListingClaims,
    estimated: ListingClaims,
    rng: Rng,
  ): Planted;
}

const clone = (rows: readonly object[]): Row[] => rows.map((r) => ({ ...r }));
const round1 = (x: number) => Math.round(x * 10) / 10;
const floor5 = (x: number) => Math.floor(x / 5) * 5;

/** A listing that states exactly what the rows hold (coverage rounded down to a multiple of 5, as a vendor would). */
export function truthfulClaims(
  rows: readonly object[],
  visits: readonly object[],
): ListingClaims {
  const subjects = rows as readonly Row[];
  const events = subjects.filter((r) => Number(r.died) === 1).length;
  const present = subjects.filter(
    (r) => r.baseline_fvc_pct !== null && r.baseline_fvc_pct !== undefined,
  ).length;
  return {
    subjects: new Set(subjects.map((r) => String(r.subject_key))).size,
    records: visits.length,
    eventRatePct: round1((events / subjects.length) * 100),
    coveragePct: {
      baseline_fvc_pct: floor5((present / subjects.length) * 100),
    },
    noPostIndexFeatures: true,
    uniqueSubjects: true,
  };
}

/** Mean AUC of a binormal score with separation d: Phi(d / sqrt 2). */
export const aucOfSeparation = (d: number): number => normalCdf(d / Math.SQRT2);

function plantLeak(base: AlsCohort, d: number, rng: Rng): Row[] {
  return clone(base.subjects).map((r) => ({
    ...r,
    // Recorded at the end of follow-up and split by outcome, with strength d.
    last_contact_alsfrs: round(rng.normal(0, 1) + d * Number(r.died), 3),
  }));
}

function plantMissing(base: AlsCohort, rate: number, rng: Rng): Row[] {
  return clone(base.subjects).map((r) =>
    rng.chance(rate) ? { ...r, baseline_fvc_pct: null } : r,
  );
}

function plantDuplicates(base: AlsCohort, rate: number, rng: Rng): Row[] {
  const rows = clone(base.subjects);
  const count = Math.max(1, Math.ceil(rate * rows.length));
  const idx = rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng.next() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  for (const i of idx.slice(0, count)) rows.push({ ...rows[i] });
  return rows;
}

function plantArms(
  base: AlsCohort,
  slope: number,
  rng: Rng,
): { rows: Row[]; smd: number } {
  const rows: Row[] = clone(base.subjects).map((r) => ({
    ...r,
    arm:
      rng.next() < 1 / (1 + Math.exp(-slope * (Number(r.age_at_onset) - 61)))
        ? "B"
        : "A",
  }));
  const a = rows
    .filter((r) => r.arm === "A")
    .map((r) => Number(r.age_at_onset));
  const b = rows
    .filter((r) => r.arm === "B")
    .map((r) => Number(r.age_at_onset));
  return { rows, smd: Math.abs(smdNumeric(a, b)) };
}

const LEAK_D = [0.5, 1.0, 1.5, 1.8, 2.2, 3.0];
const MISSING_RATES = [0.1, 0.2, 0.3, 0.5, 0.7];
const DUP_RATES = [0.005, 0.01, 0.02, 0.05, 0.1];
const ARM_SLOPES = [0.02, 0.05, 0.1, 0.2, 0.4];
const COUNT_GAPS = [0.01, 0.03, 0.06, 0.12, 0.25];
const EVENT_GAPS = [1, 3, 6, 10, 15];
const COVERAGE_GAPS = [3, 6, 10, 16, 25];
const pctLabel = (x: number) => `${round(x * 100, 1)}%`;

export function buildConditions(): Condition[] {
  const out: Condition[] = [];
  const plain = (
    rows: Row[],
    base: AlsCohort,
    extra: Partial<Planted> = {},
  ): Planted => ({
    subjects: rows,
    visits: base.visits,
    claims: null,
    ...extra,
  });

  out.push({
    id: "clean",
    family: "clean",
    check: "claim",
    label: "clean, no listing",
    level: 0,
    plant: (b) => plain(clone(b.subjects), b),
  });
  out.push({
    id: "clean_truthful",
    family: "clean",
    check: "claim",
    label: "clean, truthful listing",
    level: 0,
    plant: (b, honest) => plain(clone(b.subjects), b, { claims: honest }),
  });
  out.push({
    id: "clean_estimated",
    family: "clean",
    check: "claim",
    label: "clean, listing estimated from another sample",
    level: 0,
    plant: (b, _h, estimated) =>
      plain(clone(b.subjects), b, { claims: estimated }),
  });

  for (const d of LEAK_D) {
    out.push({
      id: `leak_${d}`,
      family: "leak",
      check: "label_association",
      label: `outcome leak, AUC about ${round(aucOfSeparation(d), 2)}`,
      level: round(aucOfSeparation(d), 2),
      plant: (b, _h, _e, rng) => plain(plantLeak(b, d, rng), b),
    });
  }
  for (const r of MISSING_RATES) {
    out.push({
      id: `missing_${r}`,
      family: "missing",
      check: "coverage",
      label: `FVC extra missing ${pctLabel(r)}`,
      level: r,
      plant: (b, _h, _e, rng) => plain(plantMissing(b, r, rng), b),
    });
  }
  for (const r of DUP_RATES) {
    out.push({
      id: `dup_${r}`,
      family: "duplicates",
      check: "subject_overlap",
      label: `duplicate subjects ${pctLabel(r)}`,
      level: r,
      plant: (b, _h, _e, rng) => plain(plantDuplicates(b, r, rng), b),
    });
  }
  for (const k of ARM_SLOPES) {
    out.push({
      id: `arms_${k}`,
      family: "imbalance",
      check: "imbalance",
      label: `arm assigned by age, slope ${k}`,
      level: k,
      plant: (b, _h, _e, rng) => {
        const { rows, smd } = plantArms(b, k, rng);
        return plain(rows, b, { note: smd });
      },
    });
  }
  for (const g of COUNT_GAPS) {
    out.push({
      id: `claim_subjects_${g}`,
      family: "claim",
      check: "claim",
      label: `claimed subjects ${pctLabel(g)} off`,
      level: g,
      plant: (b, h) =>
        plain(clone(b.subjects), b, {
          claims: { ...h, subjects: Math.round(h.subjects / (1 - g)) },
        }),
    });
  }
  for (const g of COUNT_GAPS) {
    out.push({
      id: `claim_records_${g}`,
      family: "claim",
      check: "claim",
      label: `claimed records ${pctLabel(g)} off`,
      level: g,
      plant: (b, h) =>
        plain(clone(b.subjects), b, {
          claims: { ...h, records: Math.round(h.records / (1 - g)) },
        }),
    });
  }
  for (const g of EVENT_GAPS) {
    out.push({
      id: `claim_events_${g}`,
      family: "claim",
      check: "claim",
      label: `claimed event rate ${g} points off`,
      level: g,
      plant: (b, h) =>
        plain(clone(b.subjects), b, {
          claims: {
            ...h,
            eventRatePct: round1(Math.min(100, h.eventRatePct + g)),
          },
        }),
    });
  }
  for (const g of COVERAGE_GAPS) {
    out.push({
      id: `claim_coverage_${g}`,
      family: "claim",
      check: "claim",
      label: `FVC coverage about ${g} points under the claim`,
      level: g,
      plant: (b, h, _e, rng) =>
        plain(plantMissing(b, g / 100, rng), b, { claims: h }),
    });
  }
  out.push({
    id: "claim_no_post_index",
    family: "claim",
    check: "claim",
    label: "listing says no post-index feature; a strong one is present",
    level: 1,
    plant: (b, h, _e, rng) =>
      plain(plantLeak(b, 3, rng), b, {
        claims: h,
        featureTiming: { last_contact_alsfrs: "followup" },
      }),
  });
  for (const r of [0.005, 0.02, 0.1]) {
    out.push({
      id: `claim_unique_${r}`,
      family: "claim",
      check: "claim",
      label: `listing says one row per subject; ${pctLabel(r)} repeat`,
      level: r,
      plant: (b, h, _e, rng) =>
        plain(plantDuplicates(b, r, rng), b, {
          claims: { ...h, records: b.visits.length },
        }),
    });
  }
  return out;
}

export interface RunOutcome {
  flagged: CheckId[];
  blocked: boolean;
  verdict: FitnessReport["verdict"];
}

/** Same rule the delivery audit uses: only a failed claim finding holds money. */
export const blocksMoney = (report: FitnessReport): boolean =>
  report.findings.some((f) => f.id === "claim" && f.severity === "fail");

export function auditPlanted(p: Planted): RunOutcome {
  const report = runFitnessAudit({
    datasetId: "eval",
    stage: "delivery",
    synthetic: true,
    study: STUDY,
    subjects: p.subjects,
    visits: p.visits as AlsVisit[],
    featureTiming: p.featureTiming,
    claims: p.claims,
    leakImpact: false,
  });
  const flagged = CHECK_IDS.filter((id) =>
    report.findings.some(
      (f) => f.id === id && (f.severity === "warn" || f.severity === "fail"),
    ),
  );
  return { flagged, blocked: blocksMoney(report), verdict: report.verdict };
}

export interface CellResult {
  runs: number;
  flagged: Record<CheckId, Proportion>;
  /** Share of runs where money would be held. */
  blocked: Proportion;
  /** Share of runs with an overall fail verdict. */
  verdictFail: Proportion;
  /** Median of the condition's own note, e.g. the age SMD. */
  medianNote?: number;
}

export interface ConditionResult {
  id: string;
  family: Condition["family"];
  check: CheckId;
  label: string;
  level: number;
  bySize: Record<string, CellResult>;
}

export interface LeakImpactRow {
  label: string;
  /** Planted outcome AUC of the column alone, or null for the control. */
  plantedAuc: number | null;
  runs: number;
  meanAucWith: number;
  meanAucWithout: number;
  meanGap: number;
  /** Share of runs whose gap reached the leak line. */
  shareOverLine: Proportion;
}

export interface AuditEvalResult {
  schema: "meddata-audit-eval/1";
  synthetic: true;
  limitations: string;
  config: {
    seedsPerCondition: number;
    sizes: number[];
    baseSeed: number;
    leakImpactSeeds: number;
    leakLine: number;
  };
  summary: {
    falseAlarmByCheck: Record<string, Record<CheckId, Proportion>>;
    falseBlockTruthful: Record<string, Proportion>;
    falseBlockEstimated: Record<string, Proportion>;
  };
  /** What was changed after seeing this eval, and on which seeds it was checked again. */
  tuning: string;
  conditions: ConditionResult[];
  leakImpact: Record<string, LeakImpactRow[]>;
  /** Does the leak gap hold up when the flagged column is picked by the real screen? */
  selection?: SelectionEval;
  /** Sample vs delivery drift check: false alarms on same-process data, detection of graded shifts. */
  drift?: DriftEval;
  /** Clean and imbalance conditions re-run on seeds that were not used when the imbalance rule was tuned. */
  freshSeeds?: AuditEvalResult;
}

export interface SelectionEval {
  note: string;
  noiseColumns: number;
  /** Share of cohorts where the real screen flagged any pure-noise column. */
  screenFlaggedNoise: Record<string, Proportion>;
  /** Forced: the best-looking of K noise columns (picked on all rows) fed to the leak model. */
  bestOfK: Record<
    string,
    {
      k: number;
      runs: number;
      meanSelectedAuc: number;
      meanGap: number;
      shareOverLine: Proportion;
    }
  >;
}

export interface DriftEval {
  /** Share of identical-process sample/delivery pairs where any column was flagged. */
  falseAlarm: Record<string, Proportion>;
  conditions: {
    id: string;
    label: string;
    column: string;
    level: number;
    /** Share of pairs where the shifted column was flagged. */
    bySize: Record<string, Proportion>;
  }[];
}

export const TUNING_NOTE =
  "The imbalance check was changed after a first run of this eval (commit 078aab0) showed it flagged most small clean cohorts: " +
  "the standardized difference must now also exceed 2.58 standard errors (SMD_NOISE_Z). " +
  "That rule was tuned on base seed 1000, the seeds of the main tables, so the main imbalance numbers are in-sample. " +
  "The freshSeeds block re-runs clean and imbalance on base seed 900000, which was not used for tuning. " +
  "Every other threshold is unchanged from before the eval.";

export const LIMITATIONS =
  "All cohorts are SYNTHETIC, made by lib/synth/als, and the checks were designed against that same generator family. " +
  "In the per-check tables the flaws are injected by this script at graded strengths, one at a time. " +
  "The leak_impact, selection and drift sections are different setups: leak_impact force-flags a named column on clean or leaked rows, " +
  "selection adds pure-noise columns, and drift pairs two independent clean cohorts. " +
  "leak_impact uses death by month 12 while the screens use the outcome at any time. " +
  "These numbers describe how the checks behave on that setup. They do not measure performance on real data, " +
  "real vendors, or flaws that look different from the ones planted here. A pass is a screen, not proof.";

export interface EvalOptions {
  seeds?: number;
  sizes?: number[];
  baseSeed?: number;
  leakImpactSeeds?: number;
  /** Only run these families (clean is always needed for the summary). */
  families?: (Condition["family"] | "drift")[];
  /** Also re-run clean and imbalance on seeds never used for tuning. Default true. */
  fresh?: boolean;
}

/** Seeds the imbalance rule was NOT tuned on. */
export const FRESH_BASE_SEED = 900_000;

function emptyTally(): Record<CheckId, number> {
  return Object.fromEntries(CHECK_IDS.map((c) => [c, 0])) as Record<
    CheckId,
    number
  >;
}

export function runAuditEval(opts: EvalOptions = {}): AuditEvalResult {
  const seeds = opts.seeds ?? 200;
  const sizes = opts.sizes ?? [100, 200, 400, 1000];
  const baseSeed = opts.baseSeed ?? 1000;
  const leakSeeds = opts.leakImpactSeeds ?? 20;
  const all = buildConditions();
  const conditions = opts.families
    ? all.filter(
        (c) => c.family === "clean" || opts.families!.includes(c.family),
      )
    : all;

  const tallies = new Map<
    string,
    {
      flagged: Record<CheckId, number>;
      blocked: number;
      fail: number;
      notes: number[];
    }
  >();
  const key = (cid: string, n: number) => `${cid}@${n}`;
  for (const c of conditions)
    for (const n of sizes)
      tallies.set(key(c.id, n), {
        flagged: emptyTally(),
        blocked: 0,
        fail: 0,
        notes: [],
      });

  for (const n of sizes) {
    for (let i = 0; i < seeds; i += 1) {
      const seed = baseSeed + i;
      const base = generateAlsCohort({ seed, variant: "clean", subjects: n });
      const other = generateAlsCohort({
        seed: seed + 500_000,
        variant: "clean",
        subjects: n,
      });
      const honest = truthfulClaims(base.subjects, base.visits);
      const estimated = truthfulClaims(other.subjects, other.visits);
      conditions.forEach((c) => {
        const ci = all.findIndex((x) => x.id === c.id);
        const rng = createRng(seed * 7919 + ci * 104_729 + n);
        const planted = c.plant(base, honest, estimated, rng);
        const out = auditPlanted(planted);
        const t = tallies.get(key(c.id, n))!;
        for (const f of out.flagged) t.flagged[f] += 1;
        if (out.blocked) t.blocked += 1;
        if (out.verdict === "fail") t.fail += 1;
        if (planted.note !== undefined) t.notes.push(planted.note);
      });
    }
  }

  const results: ConditionResult[] = conditions.map((c) => {
    const bySize: Record<string, CellResult> = {};
    for (const n of sizes) {
      const t = tallies.get(key(c.id, n))!;
      bySize[String(n)] = {
        runs: seeds,
        flagged: Object.fromEntries(
          CHECK_IDS.map((id) => [id, wilson(t.flagged[id], seeds)]),
        ) as Record<CheckId, Proportion>,
        blocked: wilson(t.blocked, seeds),
        verdictFail: wilson(t.fail, seeds),
        ...(t.notes.length ? { medianNote: round(median(t.notes), 3) } : {}),
      };
    }
    return {
      id: c.id,
      family: c.family,
      check: c.check,
      label: c.label,
      level: c.level,
      bySize,
    };
  });

  const byId = (id: string) => results.find((r) => r.id === id)!;
  const falseAlarmByCheck: Record<string, Record<CheckId, Proportion>> = {};
  const falseBlockTruthful: Record<string, Proportion> = {};
  const falseBlockEstimated: Record<string, Proportion> = {};
  for (const n of sizes) {
    falseAlarmByCheck[String(n)] = byId("clean").bySize[String(n)].flagged;
    falseBlockTruthful[String(n)] =
      byId("clean_truthful").bySize[String(n)].blocked;
    falseBlockEstimated[String(n)] =
      byId("clean_estimated").bySize[String(n)].blocked;
  }

  return {
    schema: "meddata-audit-eval/1",
    synthetic: true,
    limitations: LIMITATIONS,
    config: {
      seedsPerCondition: seeds,
      sizes,
      baseSeed,
      leakImpactSeeds: leakSeeds,
      leakLine: LEAK_GAP,
    },
    summary: { falseAlarmByCheck, falseBlockTruthful, falseBlockEstimated },
    conditions: results,
    tuning: TUNING_NOTE,
    ...(leakSeeds > 0
      ? { selection: selectionSection(sizes, seeds, baseSeed, leakSeeds) }
      : {}),
    ...(!opts.families || opts.families.includes("drift")
      ? { drift: driftSection(sizes, seeds, baseSeed) }
      : {}),
    leakImpact:
      leakSeeds > 0 ? leakImpactSection(sizes, baseSeed, leakSeeds) : {},
    ...(opts.fresh === false
      ? {}
      : {
          freshSeeds: runAuditEval({
            seeds,
            sizes,
            baseSeed: FRESH_BASE_SEED,
            leakImpactSeeds: 0,
            families: ["imbalance"],
            fresh: false,
          }),
        }),
  };
}

interface DriftCase {
  id: string;
  label: string;
  column: string;
  level: number;
  shift(rows: Row[], rng: Rng): Row[];
}

const DRIFT_CASES: DriftCase[] = [
  ...[1, 3, 6, 10].map((k) => ({
    id: `drift_age_${k}`,
    label: `age at onset shifted up ${k} years`,
    column: "age_at_onset",
    level: k,
    shift: (rows: Row[]) =>
      rows.map((r) => ({ ...r, age_at_onset: Number(r.age_at_onset) + k })),
  })),
  ...[0.05, 0.15, 0.3, 0.5].map((q) => ({
    id: `drift_fvc_missing_${q}`,
    label: `FVC missing in ${pctLabel(q)} more rows`,
    column: "baseline_fvc_pct",
    level: q,
    shift: (rows: Row[], rng: Rng) =>
      rows.map((r) => (rng.chance(q) ? { ...r, baseline_fvc_pct: null } : r)),
  })),
  ...[0.1, 0.25, 0.5].map((f) => ({
    id: `drift_sex_${f}`,
    label: `${pctLabel(f)} of women recorded as men`,
    column: "sex",
    level: f,
    shift: (rows: Row[], rng: Rng) =>
      rows.map((r) =>
        r.sex === "F" && rng.chance(f) ? { ...r, sex: "M" } : r,
      ),
  })),
];

/**
 * Drift check on SYNTHETIC pairs. The sample is one clean cohort and the
 * delivery is an independent clean cohort of the same size from the same
 * process, optionally shifted. Nothing here was used to set the drift floor,
 * which comes from the chi-square null, not from this eval.
 */
function driftSection(
  sizes: number[],
  seeds: number,
  baseSeed: number,
): DriftEval {
  const falseK: Record<string, number> = {};
  const hitK: Record<string, number> = {};
  for (const n of sizes) {
    falseK[String(n)] = 0;
    for (const c of DRIFT_CASES) hitK[`${c.id}@${n}`] = 0;
    for (let i = 0; i < seeds; i += 1) {
      const seed = baseSeed + i;
      const sample = clone(
        generateAlsCohort({ seed, variant: "clean", subjects: n }).subjects,
      );
      const delivery = clone(
        generateAlsCohort({
          seed: seed + 500_000,
          variant: "clean",
          subjects: n,
        }).subjects,
      );
      const flaggedCols = (rows: Row[]) =>
        new Set(
          checkDrift(sample, rows, { ignore: ["subject_key"] })
            .filter((f) => f.severity === "warn" && f.column)
            .map((f) => f.column),
        );
      if (flaggedCols(delivery).size > 0) falseK[String(n)] += 1;
      DRIFT_CASES.forEach((c, ci) => {
        const rng = createRng(seed * 6007 + ci * 15_485_863 + n);
        if (flaggedCols(c.shift(delivery, rng)).has(c.column))
          hitK[`${c.id}@${n}`] += 1;
      });
    }
  }
  const falseAlarm: Record<string, Proportion> = {};
  for (const n of sizes)
    falseAlarm[String(n)] = wilson(falseK[String(n)], seeds);
  return {
    falseAlarm,
    conditions: DRIFT_CASES.map((c) => ({
      id: c.id,
      label: c.label,
      column: c.column,
      level: c.level,
      bySize: Object.fromEntries(
        sizes.map((n) => [String(n), wilson(hitK[`${c.id}@${n}`], seeds)]),
      ),
    })),
  };
}

const SELECTION_NOTE =
  "The screens pick flagged columns on all rows, outside the cross-validation. " +
  "Real-screen arm: at the screens' own thresholds a pure-noise column was not flagged (screenFlaggedNoise), so chance selection does not reach the leak model. " +
  "Worst-case arm: forcing the best-looking of K noise columns into the leak model gave a mean gap near zero (bestOfK), though a few small-n runs crossed the leak line. " +
  "On this evidence selection bias is small, and no in-fold re-screening was added. " +
  "It only covers noise columns; a real column near the 0.9 threshold could still be picked partly by luck. Synthetic data only.";
const NOISE_COLUMNS = 10;
const BEST_OF_K = 50;
const EXCLUDED = ["subject_key", "died", "survival_months", "arm"];

function addNoise(rows: Row[], count: number, rng: Rng): Row[] {
  return rows.map((r) => {
    const out: Row = { ...r };
    for (let j = 0; j < count; j += 1)
      out[`noise_${j}`] = round(rng.normal(0, 1), 3);
    return out;
  });
}

/**
 * Selection check. The leak model is told which columns the screens flagged,
 * and the screens look at all rows, outside the cross-validation. So a column
 * picked by chance could look better than it is. Two arms, both SYNTHETIC:
 *  - the real screen, end to end, on clean data plus pure-noise columns
 *  - the worst case: forcibly take the best-looking of K noise columns
 */
function selectionSection(
  sizes: number[],
  seeds: number,
  baseSeed: number,
  leakSeeds: number,
): SelectionEval {
  const screenFlaggedNoise: Record<string, Proportion> = {};
  const bestOfK: SelectionEval["bestOfK"] = {};
  for (const n of sizes) {
    let flagged = 0;
    for (let i = 0; i < seeds; i += 1) {
      const seed = baseSeed + i;
      const base = generateAlsCohort({ seed, variant: "clean", subjects: n });
      const rows = addNoise(
        clone(base.subjects),
        NOISE_COLUMNS,
        createRng(seed * 13 + n),
      );
      const report = runFitnessAudit({
        datasetId: "eval",
        stage: "delivery",
        synthetic: true,
        study: STUDY,
        subjects: rows,
        visits: base.visits as AlsVisit[],
        leakImpact: false,
      });
      const noiseFlag = report.findings.some(
        (f) =>
          (f.id === "label_association" || f.id === "temporal_leak") &&
          (f.severity === "warn" || f.severity === "fail") &&
          f.column?.startsWith("noise_"),
      );
      if (noiseFlag) flagged += 1;
    }
    screenFlaggedNoise[String(n)] = wilson(flagged, seeds);

    const gaps: number[] = [];
    const aucs: number[] = [];
    for (let i = 0; i < leakSeeds; i += 1) {
      const seed = baseSeed + i;
      const base = generateAlsCohort({ seed, variant: "clean", subjects: n });
      const rows = addNoise(
        clone(base.subjects),
        BEST_OF_K,
        createRng(seed * 17 + n),
      );
      const y = rows.map((r) => Number(r.died));
      let best = "noise_0";
      let bestAuc = 0.5;
      for (let j = 0; j < BEST_OF_K; j += 1) {
        const a =
          rankAuc(
            rows.map((r) => Number(r[`noise_${j}`])),
            y,
          ) ?? 0.5;
        if (Math.abs(a - 0.5) > Math.abs(bestAuc - 0.5)) {
          best = `noise_${j}`;
          bestAuc = a;
        }
      }
      const features = [
        ...Object.keys(base.subjects[0]).filter((c) => !EXCLUDED.includes(c)),
        best,
      ];
      const keep = rows.map((r) => {
        const o: Row = {};
        for (const c of [...features, "died", "survival_months"]) o[c] = r[c];
        return o;
      });
      const r = measureLeakImpact({
        subjects: keep,
        label: "died",
        timeColumn: "survival_months",
        features,
        flagged: [best],
      });
      if ("skipped" in r) continue;
      gaps.push(r.gap);
      aucs.push(Math.max(bestAuc, 1 - bestAuc));
    }
    bestOfK[String(n)] = {
      k: BEST_OF_K,
      runs: gaps.length,
      meanSelectedAuc: round(mean(aucs), 3),
      meanGap: round(mean(gaps), 3),
      shareOverLine: wilson(
        gaps.filter((g) => g >= LEAK_GAP).length,
        gaps.length,
      ),
    };
  }
  return {
    note: SELECTION_NOTE,
    noiseColumns: NOISE_COLUMNS,
    screenFlaggedNoise,
    bestOfK,
  };
}

const LEAK_IMPACT_D = [1.5, 2.2, 3.0];

/** AUC gap from the leak_impact model on clean data (a real column flagged as a control) versus leaked data. */
function leakImpactSection(
  sizes: number[],
  baseSeed: number,
  seeds: number,
): Record<string, LeakImpactRow[]> {
  const out: Record<string, LeakImpactRow[]> = {};
  for (const n of sizes) {
    const arms: { label: string; d: number | null }[] = [
      { label: "control: clean data, baseline_alsfrs flagged", d: null },
      ...LEAK_IMPACT_D.map((d) => ({
        label: `leaked, column AUC about ${round(aucOfSeparation(d), 2)}`,
        d,
      })),
    ];
    out[String(n)] = arms.map((a) => {
      const gaps: number[] = [];
      const withs: number[] = [];
      const withouts: number[] = [];
      for (let i = 0; i < seeds; i += 1) {
        const seed = baseSeed + i;
        const base = generateAlsCohort({ seed, variant: "clean", subjects: n });
        const rng = createRng(seed * 31 + n);
        const rows =
          a.d === null ? clone(base.subjects) : plantLeak(base, a.d, rng);
        const flagged =
          a.d === null ? "baseline_alsfrs" : "last_contact_alsfrs";
        const features = Object.keys(rows[0]).filter(
          (c) => !["subject_key", "died", "survival_months", "arm"].includes(c),
        );
        const r = measureLeakImpact({
          subjects: rows,
          label: "died",
          timeColumn: "survival_months",
          features,
          flagged: [flagged],
        });
        if ("skipped" in r) continue;
        gaps.push(r.gap);
        withs.push(r.aucWith);
        withouts.push(r.aucWithout);
      }
      return {
        label: a.label,
        plantedAuc: a.d === null ? null : round(aucOfSeparation(a.d), 3),
        runs: gaps.length,
        meanAucWith: round(mean(withs), 3),
        meanAucWithout: round(mean(withouts), 3),
        meanGap: round(mean(gaps), 3),
        shareOverLine: wilson(
          gaps.filter((g) => g >= LEAK_GAP).length,
          gaps.length,
        ),
      };
    });
  }
  return out;
}

const pad = (s: string, w: number) =>
  s.length >= w ? s : s + " ".repeat(w - s.length);
const padL = (s: string, w: number) =>
  s.length >= w ? s : " ".repeat(w - s.length) + s;
const pc = (p: Proportion) => String(Math.round(p.rate * 100));
const ci = (p: Proportion) =>
  `${pc(p)} [${Math.round(p.lo * 100)}-${Math.round(p.hi * 100)}]`;

/** A compact text table of the result, for the terminal. */
export function formatAuditTable(r: AuditEvalResult): string {
  const sizes = r.config.sizes.map(String);
  const lines: string[] = [];
  const head = (title: string) =>
    lines.push("", title, "-".repeat(title.length));
  const cols = (label: string, cells: string[]) =>
    lines.push(pad(label, 58) + cells.map((c) => padL(c, 18)).join(""));

  lines.push(
    `SYNTHETIC audit eval: ${r.config.seedsPerCondition} seeds per condition and size, base seed ${r.config.baseSeed}`,
  );
  lines.push(
    "Rates are percent with 95% Wilson intervals. Not a measure of real-world performance.",
  );

  head(
    "False alarm on clean data, by check (percent of clean cohorts flagged)",
  );
  cols(
    "check",
    sizes.map((n) => `n=${n}`),
  );
  for (const id of CHECK_IDS) {
    if (id === "claim") continue;
    cols(
      id,
      sizes.map((n) => ci(r.summary.falseAlarmByCheck[n][id])),
    );
  }

  head("FALSE BLOCK: clean data, money held up by a failed claim");
  cols(
    "truthful listing (the headline number)",
    sizes.map((n) => ci(r.summary.falseBlockTruthful[n])),
  );
  cols(
    "listing estimated from another sample",
    sizes.map((n) => ci(r.summary.falseBlockEstimated[n])),
  );

  head(
    "Sensitivity: percent of planted-flaw cohorts flagged by the check that should catch them",
  );
  lines.push(
    "claim rows show flagged/held, where held means a failed claim finding (money held up)",
  );
  cols(
    "condition (check)",
    sizes.map((n) => `n=${n}`),
  );
  for (const c of r.conditions) {
    if (c.family === "clean") continue;
    cols(
      `${c.label} (${c.check})`,
      sizes.map((n) => {
        const cell = c.bySize[n];
        const f = Math.round(cell.flagged[c.check].rate * 100);
        const note =
          cell.medianNote !== undefined ? ` s${cell.medianNote}` : "";
        return c.family === "claim"
          ? `${f}/${Math.round(cell.blocked.rate * 100)}`
          : `${f}${note}`;
      }),
    );
  }

  head(
    "leak_impact: held-out AUC with and without the flagged column (mean over seeds)",
  );
  cols(
    "case",
    sizes.map((n) => `n=${n}`),
  );
  const labels = r.leakImpact[sizes[0]].map((x) => x.label);
  labels.forEach((label, i) =>
    cols(
      label,
      sizes.map((n) => {
        const x = r.leakImpact[n][i];
        return `${x.meanAucWith.toFixed(2)}/${x.meanAucWithout.toFixed(2)} g${x.meanGap.toFixed(2)}`;
      }),
    ),
  );
  if (r.freshSeeds) {
    const f = r.freshSeeds;
    head(
      `Fresh seeds (base ${f.config.baseSeed}, not used for tuning): imbalance rule`,
    );
    cols(
      "",
      sizes.map((n) => `n=${n}`),
    );
    cols(
      "false alarm on clean data (imbalance)",
      sizes.map((n) => ci(f.summary.falseAlarmByCheck[n].imbalance)),
    );
    for (const c of f.conditions.filter((x) => x.family === "imbalance"))
      cols(
        `${c.label} (flagged)`,
        sizes.map(
          (n) =>
            `${Math.round(c.bySize[n].flagged.imbalance.rate * 100)} s${c.bySize[n].medianNote}`,
        ),
      );
  }
  if (r.selection) {
    const sel = r.selection;
    head("Selection check: does a chance-picked column inflate the leak gap?");
    cols(
      "",
      sizes.map((n) => `n=${n}`),
    );
    cols(
      `real screen flags any of ${sel.noiseColumns} noise columns (%)`,
      sizes.map((n) => ci(sel.screenFlaggedNoise[n])),
    );
    cols(
      `best of ${BEST_OF_K} noise columns: its AUC vs outcome`,
      sizes.map((n) => sel.bestOfK[n].meanSelectedAuc.toFixed(3)),
    );
    cols(
      "  mean leak_impact gap if it were flagged",
      sizes.map((n) => sel.bestOfK[n].meanGap.toFixed(3)),
    );
    cols(
      "  share of runs with gap over the leak line (%)",
      sizes.map((n) => ci(sel.bestOfK[n].shareOverLine)),
    );
  }
  if (r.drift) {
    head(
      "Drift check: sample vs delivery from the same process (percent flagged)",
    );
    cols(
      "",
      sizes.map((n) => `n=${n}`),
    );
    cols(
      "false alarm on identical-process data (any column)",
      sizes.map((n) => ci(r.drift!.falseAlarm[n])),
    );
    for (const c of r.drift.conditions)
      cols(
        `${c.label} (${c.column})`,
        sizes.map((n) => ci(c.bySize[n])),
      );
  }
  return lines.join("\n");
}

/** Round every proportion for a stable file. */
export function roundedForFile(result: AuditEvalResult): AuditEvalResult {
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if ("k" in o && "n" in o && "rate" in o && "lo" in o && "hi" in o)
        return {
          k: o.k,
          n: o.n,
          rate: round(o.rate as number),
          lo: round(o.lo as number),
          hi: round(o.hi as number),
        };
      return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, fix(x)]));
    }
    return v;
  };
  return fix(result) as AuditEvalResult;
}
