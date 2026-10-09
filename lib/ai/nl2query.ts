// Natural-language to query translator.
// Converts a researcher's plain-English question into a safe, parameterized
// query against a purchased dataset's schema.
//
// MOCK (stub for a hosted LLM): deterministic keyword-intent parsing that only
// ever emits AGGREGATE SQL (COUNT / AVG / MIN / MAX / grouped counts) against a
// generic `records` table scoped by dataset. There is no network and no model
// call, so the flow runs locally. The real version will prompt a schema-aware
// LLM, validate the plan against the dataset's columns, and parameterize — but
// the async signature and the aggregate-only / parameterized output contract
// are identical so the swap is local.

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

// Columns a mock aggregate is allowed to reference. The real version would pull
// this from the dataset schema; here we whitelist a few generic numeric/group
// fields so an unrecognized field name can never reach the SQL string.
const NUMERIC_FIELDS = ["age", "value", "cost", "los", "bmi", "score"] as const;
const GROUP_FIELDS = [
  "sex",
  "region",
  "age_group",
  "diagnosis",
  "year",
] as const;

const DEFAULT_NUMERIC_FIELD = "value";

// Pick the first whitelisted field mentioned in the question, else a default.
// Whitelisting (never interpolating the raw phrase) is what keeps an unknown or
// malicious column name out of the emitted SQL.
function pickField(
  question: string,
  allowed: readonly string[],
  fallback: string,
): string {
  const q = question.toLowerCase();
  for (const field of allowed) {
    // Match the field name (or its spaced form "age_group" -> "age group") on
    // word boundaries, so "age" does not fire inside "average".
    const spaced = field.replace(/_/g, "[ _]");
    if (new RegExp(`\\b${spaced}\\b`).test(q)) {
      return field;
    }
  }
  return fallback;
}

// Detect an optional "by <group>" / "per <group>" / "grouped by <group>"
// request and return a whitelisted group column, or null.
function detectGroupBy(question: string): string | null {
  const q = question.toLowerCase();
  if (!/\b(by|per|grouped by|group by|broken down by)\b/.test(q)) {
    return null;
  }
  for (const field of GROUP_FIELDS) {
    const spaced = field.replace(/_/g, "[ _]");
    if (new RegExp(`\\b${spaced}\\b`).test(q)) {
      return field;
    }
  }
  return null;
}

export async function nl2query(
  question: string,
  datasetId: string,
): Promise<CompiledQuery> {
  // NOTE: real implementation — prompt the LLM with the dataset schema, have it
  // return a structured aggregate plan, validate every field against the schema,
  // then compile to parameterized SQL here. The checks below are the mock stand-in.
  const q = question.toLowerCase();

  // The dataset id is the ONLY user-influenced value bound into the query, and
  // it is always a bound parameter, never interpolated. Group columns and
  // aggregate fields come from fixed whitelists above, so no free-text from the
  // question is ever concatenated into `sql` — this is the injection-safety point.
  const params: unknown[] = [datasetId];
  const groupBy = detectGroupBy(question);

  // Intent: average / mean of a numeric field -> AVG(<field>)
  if (/\b(average|avg|mean)\b/.test(q)) {
    const field = pickField(question, NUMERIC_FIELDS, DEFAULT_NUMERIC_FIELD);
    const select = groupBy
      ? `SELECT ${groupBy} AS "group", AVG(${field}) AS avg_${field}`
      : `SELECT AVG(${field}) AS avg_${field}`;
    const sql = groupBy
      ? `${select} FROM records WHERE dataset_id = ? GROUP BY ${groupBy}`
      : `${select} FROM records WHERE dataset_id = ?`;
    return { sql, params };
  }

  // Intent: minimum of a numeric field -> MIN(<field>)
  if (/\b(min|minimum|lowest|smallest|youngest)\b/.test(q)) {
    const field = pickField(question, NUMERIC_FIELDS, DEFAULT_NUMERIC_FIELD);
    const sql = `SELECT MIN(${field}) AS min_${field} FROM records WHERE dataset_id = ?`;
    return { sql, params };
  }

  // Intent: maximum of a numeric field -> MAX(<field>)
  if (/\b(max|maximum|highest|largest|oldest)\b/.test(q)) {
    const field = pickField(question, NUMERIC_FIELDS, DEFAULT_NUMERIC_FIELD);
    const sql = `SELECT MAX(${field}) AS max_${field} FROM records WHERE dataset_id = ?`;
    return { sql, params };
  }

  // Intent: count / how many -> COUNT(*), optionally grouped.
  // Also the SAFE FALLBACK: anything unrecognized collapses to a plain count,
  // which can never expose a row. We never emit SELECT * or row-level columns.
  if (groupBy) {
    const sql =
      `SELECT ${groupBy} AS "group", COUNT(*) AS count ` +
      `FROM records WHERE dataset_id = ? GROUP BY ${groupBy}`;
    return { sql, params };
  }
  const sql = `SELECT COUNT(*) AS count FROM records WHERE dataset_id = ?`;
  return { sql, params };
}
