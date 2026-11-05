import { test } from "node:test";
import assert from "node:assert/strict";
import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { AlsCohort, AlsSubject } from "../synth/als";
import { fixtureCohort } from "../fitness/source";
import {
  GROUP_BYS,
  GRID_MONTHS,
  parseAnalysis,
  survivalAnalysis,
  type SurvivalAnalysis,
} from "./survival-analysis";

const FLAWED = "ds_als_survival_axonpoint_v1";
const CLEAN = "ds_als_survival_motorneuron_v1";

function run(
  id: string,
  groupBy: (typeof GROUP_BYS)[number],
): SurvivalAnalysis {
  const out = survivalAnalysis(fixtureCohort(id, "delivery")!, groupBy);
  assert.equal(out.kind, "ok");
  return (out as { kind: "ok"; analysis: SurvivalAnalysis }).analysis;
}

function subject(i: number, over: Partial<AlsSubject>): AlsSubject {
  return {
    subject_key: `s${i}`,
    arm: "A",
    age_at_onset: 60,
    age_band: "60-69",
    sex: "F",
    onset_site: "spinal",
    baseline_alsfrs: 40,
    baseline_fvc_pct: 80,
    survival_months: 20,
    died: 1,
    ...over,
  };
}
function cohort(subjects: AlsSubject[]): AlsCohort {
  return {
    synthetic: true,
    variant: "clean",
    seed: 1,
    subjects,
    visits: [],
    featureTiming: {},
  };
}

test("parseAnalysis accepts only the fixed allowlist and nothing else", () => {
  for (const g of GROUP_BYS)
    assert.deepEqual(parseAnalysis({ type: "survival", groupBy: g }), {
      ok: true,
      groupBy: g,
    });
  for (const bad of [
    null,
    "survival",
    {},
    { type: "survival" },
    { type: "survival", groupBy: "patient_id" },
    { type: "survival", groupBy: "arm", where: "age > 70" },
    { type: "survival", groupBy: "arm", filter: { sex: "F" } },
    { type: "median", groupBy: "arm" },
  ])
    assert.equal(parseAnalysis(bad).ok, false, JSON.stringify(bad));
});

test("curves sit on the 3 month grid and carry no exact times", () => {
  const a = run(FLAWED, "arm");
  assert.equal(a.synthetic, true);
  assert.match(a.label, /SYNTHETIC/);
  assert.equal(a.unit, "months");
  assert.deepEqual(a.grid, [...GRID_MONTHS]);
  for (const g of a.groups) {
    assert.ok(g.curve.length >= 2);
    for (const p of g.curve) {
      assert.ok(GRID_MONTHS.includes(p.month));
      assert.equal(p.atRisk % 5, 0);
      assert.ok(p.survival >= 0 && p.survival <= 1);
    }
    // Non-increasing.
    for (let i = 1; i < g.curve.length; i += 1)
      assert.ok(g.curve[i].survival <= g.curve[i - 1].survival);
  }
  const json = JSON.stringify(a);
  assert.equal(/subject_key|survival_months|"died"/.test(json), false);
});

test("the arm gap in the flawed cohort goes away within age bands", () => {
  const a = run(FLAWED, "arm");
  assert.ok(a.logRank.raw.pValue! < 0.001);
  assert.ok(a.logRank.adjusted);
  assert.equal(a.logRank.adjusted!.stratifiedBy, "age_band");
  assert.ok(a.logRank.adjusted!.pValue > 0.05);
  assert.match(a.interpretation, /age band/);
  assert.match(a.interpretation, /does not show cause/);
  assert.equal(
    /\b(proof|prove[sn]?|causes?d?)\b/i.test(
      a.interpretation.replace(/does not show cause/, ""),
    ),
    false,
  );
});

test("a clean cohort says there is no gap to explain", () => {
  const a = run(CLEAN, "arm");
  assert.ok(a.logRank.raw.pValue! > 0.05);
  assert.doesNotMatch(a.interpretation, /goes away|disappears|no longer/);
});

test("only the arm grouping gets an adjusted test", () => {
  assert.equal(run(FLAWED, "sex").logRank.adjusted, null);
  assert.equal(run(FLAWED, "age_band").logRank.adjusted, null);
});

test("a group under the cell floor is dropped, not shown", () => {
  const subs = [
    ...Array.from({ length: 30 }, (_, i) =>
      subject(i, { arm: "A", survival_months: 5 + i }),
    ),
    ...Array.from({ length: MIN_CELL_SIZE - 1 }, (_, i) =>
      subject(100 + i, { arm: "B" }),
    ),
  ];
  const out = survivalAnalysis(cohort(subs), "arm");
  assert.equal(out.kind, "ok");
  const a = (out as { kind: "ok"; analysis: SurvivalAnalysis }).analysis;
  assert.deepEqual(
    a.groups.map((g) => g.group),
    ["A"],
  );
  assert.equal(a.withheldGroups, 1);
  assert.equal(a.logRank.raw.pValue, null);
  assert.equal(a.logRank.adjusted, null);
});

test("when every group is under the floor the answer is refused", () => {
  const subs = Array.from({ length: MIN_CELL_SIZE - 1 }, (_, i) =>
    subject(i, {}),
  );
  const out = survivalAnalysis(cohort(subs), "arm");
  assert.equal(out.kind, "refused");
});

test("a curve stops once fewer than the floor are still at risk", () => {
  // 20 people; 12 die by month 10, 8 followed to month 30. After month 10 the
  // at-risk count is 8, under the floor, so the curve ends there.
  const subs = [
    ...Array.from({ length: 12 }, (_, i) =>
      subject(i, { survival_months: 1 + (i % 9) }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      subject(50 + i, { survival_months: 30, died: 0 }),
    ),
  ];
  const out = survivalAnalysis(cohort(subs), "arm");
  const a = (out as { kind: "ok"; analysis: SurvivalAnalysis }).analysis;
  const g = a.groups[0];
  const last = g.curve[g.curve.length - 1];
  assert.ok(last.month < 30);
  assert.equal(g.truncatedAtMonth, last.month);
  // Every shown point had at least the floor still at risk (before rounding).
  for (const p of g.curve) assert.ok(p.atRisk >= MIN_CELL_SIZE - 1);
});

test("a median is only given when the curve reaches it, on the grid", () => {
  const dies = Array.from({ length: 40 }, (_, i) =>
    subject(i, { survival_months: 4 + i * 0.5 }),
  );
  const a = (
    survivalAnalysis(cohort(dies), "arm") as {
      kind: "ok";
      analysis: SurvivalAnalysis;
    }
  ).analysis;
  const m = a.groups[0].medianMonths;
  assert.ok(m !== null && m % 3 === 0);

  const alive = Array.from({ length: 20 }, (_, i) =>
    subject(i, { survival_months: 20, died: 0 }),
  );
  const b = (
    survivalAnalysis(cohort(alive), "arm") as {
      kind: "ok";
      analysis: SurvivalAnalysis;
    }
  ).analysis;
  assert.equal(b.groups[0].medianMonths, null);
});

test("at-risk counts are rounded so one person cannot be read", () => {
  const mk = (n: number) =>
    (
      survivalAnalysis(
        cohort(
          Array.from({ length: n }, (_, i) =>
            subject(i, { survival_months: 30, died: 0 }),
          ),
        ),
        "arm",
      ) as { kind: "ok"; analysis: SurvivalAnalysis }
    ).analysis.groups[0].curve[0].atRisk;
  assert.equal(mk(31), mk(32));
  assert.equal(mk(31) % 5, 0);
});
