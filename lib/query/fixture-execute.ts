// Aggregate executor for SYNTHETIC fixture datasets.
//
// The mock executor hashes the SQL text, so two datasets asked the same
// question get the same made-up numbers. A fixture dataset instead has real
// (synthetic) rows, so this executor aggregates them: counts and averages
// agree with every other view of the same rows.
//
// The "records" table here is the visit rows, each joined to its subject's
// columns. A person has many visits, so counts and age use one row per person:
// otherwise someone with twelve visits would count twelve times. Score and FVC
// change between visits, so they use every visit. Only aggregates leave this
// function, and a group with fewer people than the cell floor is dropped, as
// lib/sources/postgres.ts does with HAVING.
import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { QueryPlan } from "../ai/nl2query";
import { fixtureCohort } from "../fitness/source";
import type { AggregateRow } from "./mock-execute";
import { withheldCells } from "./suppression";

export type FixtureOutcome =
  | { kind: "none" }
  | { kind: "refused"; reason: string }
  | { kind: "rows"; rows: AggregateRow[] };

export interface RecordRow {
  /** Used to count people. It is never returned. */
  subject: string;
  age: number;
  sex: string;
  age_group: string;
  score: number;
  value: number | null;
}

// Planner field name -> column in the fixture rows. Anything not listed here
// has no meaning for these datasets.
const NUMERIC: Record<string, keyof RecordRow> = {
  age: "age",
  score: "score",
  value: "value",
};
const GROUPS: Record<string, keyof RecordRow> = {
  sex: "sex",
  age_group: "age_group",
};

const tableCache = new Map<string, RecordRow[]>();

function table(datasetId: string): RecordRow[] | null {
  const hit = tableCache.get(datasetId);
  if (hit) return hit;
  const cohort = fixtureCohort(datasetId, "delivery");
  if (!cohort) return null;
  const bySubject = new Map(cohort.subjects.map((s) => [s.subject_key, s]));
  const out: RecordRow[] = [];
  for (const v of cohort.visits) {
    const s = bySubject.get(v.subject_key);
    if (!s) continue;
    out.push({
      subject: v.subject_key,
      age: s.age_at_onset,
      sex: s.sex === "F" ? "female" : "male",
      age_group: s.age_band,
      score: v.alsfrs_total,
      value: v.fvc_pct,
    });
  }
  tableCache.set(datasetId, out);
  return out;
}

function aggregate(op: "avg" | "min" | "max", rows: RecordRow[], col: keyof RecordRow): number | null {
  const xs = rows.map((r) => r[col]).filter((v): v is number => typeof v === "number");
  if (xs.length === 0) return null;
  if (op === "min") return Math.min(...xs);
  if (op === "max") return Math.max(...xs);
  return Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100;
}

function onePerPerson(rows: RecordRow[]): RecordRow[] {
  return [...new Map(rows.map((r) => [r.subject, r])).values()];
}

/** Aggregate in-memory fixture rows. Split out so the cell floor can be tested on small tables. */
export function aggregateRows(rows: RecordRow[], plan: QueryPlan): FixtureOutcome {
  // MIN and MAX are never grouped (the planner ignores groupBy for them).
  const groupName = plan.op === "min" || plan.op === "max" ? null : plan.groupBy;
  const groupCol = groupName ? GROUPS[groupName] : null;
  if (groupName && !groupCol) {
    return {
      kind: "refused",
      reason: `This dataset has no "${groupName}" column, so it cannot be grouped that way. Try sex or age group. No query charge was recorded.`,
    };
  }
  const fieldCol = plan.op === "count" ? null : NUMERIC[plan.field ?? "value"];
  if (plan.op !== "count" && !fieldCol) {
    return {
      kind: "refused",
      reason: `This dataset has no "${plan.field}" column. Try age, score or value. No query charge was recorded.`,
    };
  }

  const alias = plan.op === "count" ? "count" : `${plan.op}_${plan.field ?? "value"}`;
  const buckets = new Map<string, RecordRow[]>();
  if (groupCol) {
    for (const r of rows) {
      const key = String(r[groupCol]);
      const list = buckets.get(key) ?? [];
      list.push(r);
      buckets.set(key, list);
    }
  } else {
    buckets.set("", rows);
  }

  const peopleIn = new Map(
    [...buckets].map(([key, cell]) => [key, onePerPerson(cell)]),
  );
  const hidden = withheldCells(
    new Map([...peopleIn].map(([key, p]) => [key, p.length])),
    MIN_CELL_SIZE,
  );

  const out: AggregateRow[] = [];
  for (const key of [...buckets.keys()].sort()) {
    if (hidden.has(key)) continue;
    const cell = buckets.get(key)!;
    const people = peopleIn.get(key)!;
    const base: AggregateRow = groupCol ? { group: key } : {};
    if (plan.op === "count") {
      out.push({ ...base, count: people.length });
      continue;
    }
    const value = aggregate(plan.op, fieldCol === "age" ? people : cell, fieldCol!);
    if (value === null) continue;
    out.push({ ...base, [alias]: value });
  }
  return { kind: "rows", rows: out };
}

export function executeFixture(datasetId: string, plan: QueryPlan): FixtureOutcome {
  const rows = table(datasetId);
  return rows ? aggregateRows(rows, plan) : { kind: "none" };
}
