// SYNTHETIC ALS-like cohorts for demos and tests. Every parameter here is
// invented. Nothing is fitted to, or derived from, any real study or patient.
// The numbers describe nothing about real disease.
//
// Two variants:
//   clean   - arms are balanced on age, FVC is mostly recorded, and no feature
//             is computed from follow-up.
//   flawed  - three planted problems for the fitness checks to find:
//             1. `last_contact_alsfrs` is derived from follow-up and leaks the
//                outcome (it is recorded at the end of follow-up, not at index).
//             2. `baseline_fvc_pct` and visit `fvc_pct` are mostly missing.
//             3. Arm B is older than arm A, but the true arm effect is zero.
//                Survival depends on age only, so a raw arm comparison shows a
//                gap that disappears once age band is held fixed.
//
// Columns use `subject_key`, never `patient_id` (that name is on the PII list).

import { createRng, type Rng } from "./prng";

export type AlsVariant = "clean" | "flawed";

export type AgeBand = "<50" | "50-59" | "60-69" | "70+";

export interface AlsSubject {
  subject_key: string;
  arm: "A" | "B";
  age_at_onset: number;
  age_band: AgeBand;
  sex: "F" | "M";
  onset_site: "spinal" | "bulbar";
  baseline_alsfrs: number;
  /** Null when not recorded. */
  baseline_fvc_pct: number | null;
  /** Months from index to death or censoring. */
  survival_months: number;
  /** 1 = died, 0 = censored. */
  died: 0 | 1;
  /** Flawed variant only. Recorded at end of follow-up. */
  last_contact_alsfrs?: number;
}

export interface AlsVisit {
  subject_key: string;
  /** Months after index. 0 is the index visit. */
  visit_month: number;
  alsfrs_total: number;
  /** Null when not recorded. */
  fvc_pct: number | null;
}

export interface AlsCohort {
  synthetic: true;
  variant: AlsVariant;
  seed: number;
  subjects: AlsSubject[];
  visits: AlsVisit[];
  /** Month (after index) at which each subject-level column becomes known. Absent = known at index. */
  featureTiming: Record<string, "followup">;
}

export interface AlsOptions {
  seed: number;
  variant: AlsVariant;
  /** Number of subjects. Default 400. */
  subjects?: number;
}

const ADMIN_CENSOR_MONTHS = 36;
const VISIT_EVERY_MONTHS = 3;

export function ageBand(age: number): AgeBand {
  if (age < 50) return "<50";
  if (age < 60) return "50-59";
  if (age < 70) return "60-69";
  return "70+";
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

interface Draft {
  age: number;
  sex: "F" | "M";
  site: "spinal" | "bulbar";
  arm: "A" | "B";
}

function drawDrafts(rng: Rng, n: number, variant: AlsVariant): Draft[] {
  const drafts: Draft[] = [];
  const counters = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    const age = Math.round(clamp(rng.normal(61, 9), 30, 85));
    const sex = rng.chance(0.45) ? "F" : "M";
    const site = rng.chance(0.25) ? "bulbar" : "spinal";
    const armDraw = rng.next();
    let arm: "A" | "B";
    if (variant === "flawed") {
      // Older subjects are more likely to land in arm B.
      arm = armDraw < 1 / (1 + Math.exp(-(age - 61) / 4)) ? "B" : "A";
    } else {
      // Alternate within strata so the arms match on age band, sex and site.
      const key = `${ageBand(age)}|${sex}|${site}`;
      const c = counters.get(key) ?? 0;
      counters.set(key, c + 1);
      arm = c % 2 === 0 ? "A" : "B";
    }
    drafts.push({ age, sex, site, arm });
  }
  return drafts;
}

export function generateAlsCohort(opts: AlsOptions): AlsCohort {
  const n = opts.subjects ?? 400;
  const rng = createRng(opts.seed);
  const flawed = opts.variant === "flawed";
  const fvcMissing = flawed ? 0.72 : 0.04;
  const drafts = drawDrafts(rng, n, opts.variant);

  const subjects: AlsSubject[] = [];
  const visits: AlsVisit[] = [];

  drafts.forEach((d, i) => {
    const subject_key = `SYN-${String(i + 1).padStart(5, "0")}`;

    // Hazard depends on age and onset site only. The arm has no effect.
    const hazard = 0.028 * Math.exp(0.06 * (d.age - 60)) * (d.site === "bulbar" ? 1.5 : 1);
    const deathAt = rng.exponential(hazard);
    const dropoutAt = rng.exponential(0.01);
    const end = Math.min(deathAt, dropoutAt, ADMIN_CENSOR_MONTHS);
    const died: 0 | 1 = deathAt <= dropoutAt && deathAt <= ADMIN_CENSOR_MONTHS ? 1 : 0;
    const survival_months = Math.max(0.5, round1(end));

    const baseline = clamp(Math.round(rng.normal(39, 4)), 20, 48);
    const decline = Math.max(0.1, rng.normal(0.7, 0.25));
    const fvc0 = clamp(rng.normal(86, 14), 30, 120);
    const fvcDecline = Math.max(0, rng.normal(1.1, 0.4));

    const baselineFvcKnown = !rng.chance(fvcMissing);
    const subject: AlsSubject = {
      subject_key,
      arm: d.arm,
      age_at_onset: d.age,
      age_band: ageBand(d.age),
      sex: d.sex,
      onset_site: d.site,
      baseline_alsfrs: baseline,
      baseline_fvc_pct: baselineFvcKnown ? round1(fvc0) : null,
      survival_months,
      died,
    };
    if (flawed) {
      // Planted leak: a score read at the end of follow-up, split by outcome.
      subject.last_contact_alsfrs = died === 1 ? rng.int(2, 14) : rng.int(20, 40);
    }
    subjects.push(subject);

    for (let m = 0; m <= survival_months; m += VISIT_EVERY_MONTHS) {
      const alsfrs = clamp(Math.round(baseline - decline * m + rng.normal(0, 1.2)), 0, 48);
      const fvcKnown = !rng.chance(fvcMissing);
      const fvc = clamp(fvc0 - fvcDecline * m + rng.normal(0, 3), 10, 120);
      visits.push({
        subject_key,
        visit_month: m,
        alsfrs_total: alsfrs,
        fvc_pct: fvcKnown ? round1(fvc) : null,
      });
    }
  });

  return {
    synthetic: true,
    variant: opts.variant,
    seed: opts.seed,
    subjects,
    visits,
    featureTiming: flawed ? { last_contact_alsfrs: "followup" } : {},
  };
}
