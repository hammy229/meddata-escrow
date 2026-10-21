// Natural-language to query translator.
// Converts a researcher's plain-English question into a safe, parameterized
// query against a purchased dataset's schema.
//
// Two stages:
//   1. question -> QueryPlan  { op, field, groupBy }. When the LLM is enabled,
//      Claude on Bedrock picks the plan, constrained by a schema whose fields
//      are enums of the whitelists below. Otherwise (or if the call fails) a
//      deterministic keyword-intent parser picks it.
//   2. QueryPlan -> SQL via compilePlan, a pure function shared by both paths.
//      It re-validates the plan and only ever emits AGGREGATE SQL (COUNT / AVG
//      / MIN / MAX / grouped COUNT or AVG) against a generic `records` table
//      scoped by a bound dataset parameter.
//
// The LLM never writes SQL text: it can only choose among whitelisted enum
// values, so nothing it says can be concatenated into a query.
import * as z from "zod/v4";

import { llmEnabled, structured } from "../llm/client";
import type { AiOptions } from "./options";

// Columns an aggregate is allowed to reference. The real version would pull
// this from the dataset schema; here we whitelist a few generic numeric/group
// fields so an unrecognized field name can never reach the SQL string.
export const NUMERIC_FIELDS = [
  "age",
  "value",
  "cost",
  "los",
  "bmi",
  "score",
] as const;
export const GROUP_FIELDS = [
  "sex",
  "region",
  "age_group",
  "diagnosis",
  "year",
] as const;

const DEFAULT_NUMERIC_FIELD = "value";

export const QueryPlan = z.object({
  op: z.enum(["count", "avg", "min", "max"]),
  field: z.enum(NUMERIC_FIELDS).nullable(),
  groupBy: z.enum(GROUP_FIELDS).nullable(),
});
export type QueryPlan = z.infer<typeof QueryPlan>;

export interface CompiledQuery {
  sql: string;
  params: unknown[];
  /** The validated plan the SQL was compiled from. */
  plan?: QueryPlan;
  /** One-sentence, researcher-facing description of the plan (LLM path). */
  explanation?: string;
  /** Which planner chose the plan. */
  source?: "llm" | "keyword";
}

/**
 * Compile a plan to parameterized aggregate SQL. Pure and deterministic. The
 * plan is re-validated against the whitelists first, so a caller can never get
 * an arbitrary identifier into `sql`; the dataset id is always a bound param.
 *
 * MIN/MAX are never grouped: the extreme of a small group can single out one
 * person's value, so a groupBy on those ops is ignored.
 */
export function compilePlan(plan: QueryPlan, datasetId: string): CompiledQuery {
  const { op, field, groupBy } = QueryPlan.parse(plan);
  const params: unknown[] = [datasetId];
  const where = "FROM records WHERE dataset_id = ?";

  if (op === "count") {
    const sql = groupBy
      ? `SELECT ${groupBy} AS "group", COUNT(*) AS count ${where} GROUP BY ${groupBy}`
      : `SELECT COUNT(*) AS count ${where}`;
    return { sql, params, plan: { op, field: null, groupBy } };
  }

  const f = field ?? DEFAULT_NUMERIC_FIELD;
  if (op === "avg") {
    const sql = groupBy
      ? `SELECT ${groupBy} AS "group", AVG(${f}) AS avg_${f} ${where} GROUP BY ${groupBy}`
      : `SELECT AVG(${f}) AS avg_${f} ${where}`;
    return { sql, params, plan: { op, field: f, groupBy } };
  }

  const fn = op.toUpperCase();
  const sql = `SELECT ${fn}(${f}) AS ${op}_${f} ${where}`;
  return { sql, params, plan: { op, field: f, groupBy: null } };
}

// Pick the first whitelisted field mentioned in the question, else null.
// Whitelisting (never interpolating the raw phrase) is what keeps an unknown or
// malicious column name out of the emitted SQL.
function pickField<T extends string>(
  question: string,
  allowed: readonly T[],
): T | null {
  const q = question.toLowerCase();
  for (const field of allowed) {
    // Match the field name (or its spaced form "age_group" -> "age group") on
    // word boundaries, so "age" does not fire inside "average".
    const spaced = field.replace(/_/g, "[ _]");
    if (new RegExp(`\\b${spaced}\\b`).test(q)) {
      return field;
    }
  }
  return null;
}

// Detect an optional "by <group>" / "per <group>" / "grouped by <group>"
// request and return a whitelisted group column, or null.
function detectGroupBy(question: string): QueryPlan["groupBy"] {
  const q = question.toLowerCase();
  if (!/\b(by|per|grouped by|group by|broken down by)\b/.test(q)) {
    return null;
  }
  return pickField(question, GROUP_FIELDS);
}

/** Deterministic keyword-intent planner (the no-LLM path). */
export function keywordPlan(question: string): QueryPlan {
  const q = question.toLowerCase();
  const field = () => pickField(question, NUMERIC_FIELDS);

  if (/\b(average|avg|mean)\b/.test(q)) {
    return { op: "avg", field: field(), groupBy: detectGroupBy(question) };
  }
  if (/\b(min|minimum|lowest|smallest|youngest)\b/.test(q)) {
    return { op: "min", field: field(), groupBy: null };
  }
  if (/\b(max|maximum|highest|largest|oldest)\b/.test(q)) {
    return { op: "max", field: field(), groupBy: null };
  }
  // Count / how many, optionally grouped. Also the SAFE FALLBACK: anything
  // unrecognized collapses to a plain count, which can never expose a row.
  return { op: "count", field: null, groupBy: detectGroupBy(question) };
}

const LlmPlan = QueryPlan.extend({ explanation: z.string() });

const PLAN_SYSTEM =
  "You translate a researcher's question about a medical dataset into an " +
  "aggregate query plan. Choose op (count, avg, min, max), a numeric field " +
  "for avg/min/max (null for count), and an optional groupBy (count/avg " +
  "only). Use only the allowed enum values; if the question needs a column " +
  "that is not offered, pick the closest aggregate or a plain count. " +
  "explanation: one plain sentence describing what will be computed.";

export async function nl2query(
  question: string,
  datasetId: string,
  opts: AiOptions = {},
): Promise<CompiledQuery> {
  if (opts.useLlm ?? llmEnabled()) {
    try {
      const raw = await structured({
        system: PLAN_SYSTEM,
        prompt: `Question: ${question}`,
        schema: LlmPlan,
        client: opts.client,
      });
      // Re-validate locally: the enums are the injection boundary.
      const { explanation, ...plan } = LlmPlan.parse(raw);
      return {
        ...compilePlan(plan, datasetId),
        explanation,
        source: "llm",
      };
    } catch (err) {
      console.warn(
        `nl2query: LLM plan failed, using keyword parser (${(err as Error).message})`,
      );
    }
  }
  return {
    ...compilePlan(keywordPlan(question), datasetId),
    source: "keyword",
  };
}
