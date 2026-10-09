// Privacy guard.
// Enforces that queries and their results only ever expose privacy-safe
// aggregates (e.g. small-cell suppression, minimum group sizes) and never
// row-level records. Raw records never leave the vendor.
//
// MOCK (conservative stand-in for the real privacy layer): deterministic,
// string- and shape-based checks with no network and no model call. The real
// version would combine a schema-aware policy engine with an LLM review; the
// signatures and the allow/deny contract here match so the swap is local.
// When in doubt this mock DENIES — false positives are safe, false negatives
// leak PHI.

export interface PrivacyVerdict {
  allowed: boolean;
  reasons: string[];
}

// HIPAA Safe Harbor-style small-cell threshold. Counts below this can
// re-identify individuals in a small group, so any cell under it is suppressed.
// 11 is a widely used minimum cell size (e.g. CMS cell-suppression policy).
export const MIN_CELL_SIZE = 11;

// Obvious direct/indirect identifier columns. Selecting any of these is treated
// as a re-identification attempt. Not exhaustive — the real version uses the
// dataset's tagged-PII schema; this is a conservative keyword net.
const PII_COLUMNS = [
  "name",
  "ssn",
  "social_security",
  "mrn",
  "medical_record",
  "email",
  "dob",
  "date_of_birth",
  "birth_date",
  "address",
  "phone",
  "zip",
  "zipcode",
  "postal",
  "patient_id",
];

// Aggregate function markers. A query must look aggregate to be allowed.
const AGGREGATE_MARKERS = [
  "count(",
  "avg(",
  "min(",
  "max(",
  "sum(",
  "group by",
];

export async function checkQuery(
  query: string,
  _datasetId: string,
): Promise<PrivacyVerdict> {
  const reasons: string[] = [];
  const q = query.toLowerCase();

  // Reject row-level star selects outright — these pull whole records.
  if (/select\s+\*/.test(q)) {
    reasons.push("Query uses SELECT * (row-level export), not an aggregate.");
  }

  // Reject any reference to a known PII / identifier column.
  for (const col of PII_COLUMNS) {
    // word-boundary-ish match so "name" doesn't fire on "surname_count" etc.
    const re = new RegExp(`(^|[^a-z0-9_])${col}([^a-z0-9_]|$)`);
    if (re.test(q)) {
      reasons.push(`Query references a PII/identifier column: "${col}".`);
    }
  }

  // Reject single-record pulls (LIMIT 1 / FETCH FIRST 1), a classic way to
  // confirm one individual's presence.
  if (/\blimit\s+1\b/.test(q) || /fetch\s+first\s+1\s+row/.test(q)) {
    reasons.push("Query pulls a single record (LIMIT 1), which is row-level.");
  }

  // Require the query to actually be an aggregate. If none of the aggregate
  // markers are present, we can't prove it's safe, so deny (fail closed).
  const looksAggregate = AGGREGATE_MARKERS.some((m) => q.includes(m));
  if (!looksAggregate) {
    reasons.push(
      "Query does not use an aggregate (COUNT/AVG/MIN/MAX/SUM/GROUP BY); " +
        "only aggregate queries are permitted.",
    );
  }

  return { allowed: reasons.length === 0, reasons };
}

// Pull a count-like number out of a loosely-typed result row. Returns null when
// the row carries no interpretable count (we stay defensive about shape).
function extractCount(row: unknown): number | null {
  if (typeof row === "number") return row;
  if (row === null || typeof row !== "object") return null;

  const obj = row as Record<string, unknown>;
  // Common count-bearing keys, in priority order.
  const keys = ["count", "n", "total", "cnt", "value", "freq"];
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "number") return v;
  }
  return null;
}

// Best-effort label for naming an offending cell in `reasons`.
function cellLabel(row: unknown, index: number): string {
  if (row !== null && typeof row === "object") {
    const obj = row as Record<string, unknown>;
    const g = obj.group ?? obj.label ?? obj.key ?? obj.category;
    if (typeof g === "string" || typeof g === "number") {
      return `group "${g}"`;
    }
  }
  return `row ${index}`;
}

export async function checkResult(rows: unknown[]): Promise<PrivacyVerdict> {
  const reasons: string[] = [];

  if (!Array.isArray(rows)) {
    // Unexpected shape -> fail closed.
    return {
      allowed: false,
      reasons: ["Result is not an array of rows; cannot verify suppression."],
    };
  }

  // Small-cell suppression: any count-bearing cell strictly below MIN_CELL_SIZE
  // could re-identify individuals, so the whole result is withheld and the
  // offending cells are named.
  rows.forEach((row, i) => {
    const count = extractCount(row);
    if (count !== null && count < MIN_CELL_SIZE) {
      reasons.push(
        `${cellLabel(row, i)} has count ${count}, below the minimum cell ` +
          `size of ${MIN_CELL_SIZE}.`,
      );
    }
  });

  return { allowed: reasons.length === 0, reasons };
}
