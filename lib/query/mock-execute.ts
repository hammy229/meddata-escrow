// Mock aggregate executor.
//
// In production THIS is where the compiled, parameterized aggregate query runs
// on the VENDOR side, against the real dataset the researcher purchased. Raw
// records never leave the vendor; only the aggregate rows return. There is no
// real dataset in this demo, so we synthesize a deterministic, privacy-safe
// aggregate from the compiled query shape instead of touching any data.
//
// The output is always aggregate-shaped (grouped `{ group, count }` rows, or a
// single scalar-aggregate row) with every count safely at or above the privacy
// guard's minimum cell size, so a well-formed query is never spuriously
// suppressed. No row-level record is ever produced here.
import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { CompiledQuery } from "../ai/nl2query";

/** A single aggregate result cell. */
export type AggregateRow = Record<string, string | number>;

// Floor for synthesized counts: comfortably above the suppression threshold so
// the mock never trips small-cell suppression for a legitimate aggregate.
const SAFE_FLOOR = MIN_CELL_SIZE + 29;

// Plausible domain values per known group column (mirrors nl2query's whitelist).
const GROUP_VALUES: Record<string, string[]> = {
  sex: ["female", "male"],
  region: ["northeast", "midwest", "south", "west"],
  age_group: ["18-34", "35-49", "50-64", "65+"],
  diagnosis: ["I10", "E11", "I25", "J45"],
  year: ["2021", "2022", "2023"],
};

// Small deterministic string hash (FNV-1a style), so results are stable across
// runs without any randomness.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function safeCount(seed: string): number {
  return SAFE_FLOOR + (hash(seed) % 4000);
}

/**
 * Synthesize a deterministic aggregate result for a compiled query. Grouped
 * queries yield a few `{ group, count }` rows; scalar aggregates yield one row
 * named after the SELECT alias.
 */
export function mockExecute(compiled: CompiledQuery): AggregateRow[] {
  const sql = compiled.sql;

  // Grouped query -> one row per domain value of the group column.
  const groupBy = sql.match(/GROUP BY\s+(\w+)/i);
  if (groupBy) {
    const col = groupBy[1];
    const values = GROUP_VALUES[col] ?? ["a", "b", "c"];
    return values.map((group) => ({
      group,
      count: safeCount(`${col}:${group}`),
    }));
  }

  // Scalar aggregate -> single row keyed by the SELECT alias (e.g. `count`,
  // `avg_value`, `min_age`). AVG/MIN/MAX are given a plausible numeric value;
  // a bare COUNT gets a safely-large count.
  const alias = sql.match(/\sAS\s+(\w+)\s+FROM/i)?.[1] ?? "count";
  if (/^avg_/.test(alias)) {
    return [{ [alias]: 40 + (hash(alias) % 40) }]; // e.g. a mean in a sane range
  }
  if (/^min_/.test(alias)) {
    return [{ [alias]: 1 + (hash(alias) % 20) }];
  }
  if (/^max_/.test(alias)) {
    return [{ [alias]: 80 + (hash(alias) % 20) }];
  }
  // Default: a total count, kept well above the suppression threshold.
  return [{ [alias]: safeCount(sql) }];
}
