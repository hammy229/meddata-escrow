// Privacy guard.
// Enforces that queries and their results only ever expose privacy-safe
// aggregates (e.g. small-cell suppression, minimum group sizes) and never
// row-level records. Raw records never leave the vendor.
//
// The base layer is deterministic, string- and shape-based checks with no
// network (a conservative stand-in for a schema-aware policy engine). When the
// LLM is enabled, checkQuestion also asks Claude on Bedrock for a second
// opinion on re-identification risk — and that opinion can only TIGHTEN the
// verdict: final allowed = deterministic allowed AND Claude allowed. A Claude
// error leaves the deterministic verdict in place. When in doubt this guard
// DENIES — false positives are safe, false negatives leak PHI.
import * as z from "zod/v4";

import { llmEnabled, structured } from "../llm/client";
import { GROUP_FIELDS, NUMERIC_FIELDS } from "./nl2query";
import type { AiOptions } from "./options";

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

// Row-level intent phrasings in a plain-English question. Each pattern names a
// way to ask for individual records rather than an aggregate; the label is what
// we report back. Kept deliberately broad — a false positive just asks the
// researcher to rephrase, a false negative could leak a record.
const ROW_LEVEL_PHRASES: { re: RegExp; label: string }[] = [
  { re: /select\s+\*/, label: "SELECT *" },
  {
    re: /\blist\s+(all\s+|every\s+|the\s+)*(patients|records|rows|people|persons|members)\b/,
    label: "list of records",
  },
  {
    re: /\bshow\s+(me\s+)?(all\s+|every\s+|the\s+)*(patients|records|rows|people|data)\b/,
    label: "show records",
  },
  {
    re: /\b(each|every)\s+(patient|person|record|row|member)\b/,
    label: "each record",
  },
  { re: /\bindividual\b/, label: "individual" },
  { re: /\b(export|dump|download|raw)\b/, label: "export / raw data" },
  { re: /\blimit\s+1\b/, label: "LIMIT 1" },
  {
    re: /\b(one|single|a specific|specific|particular)\s+(patient|person|record|row|member)\b/,
    label: "a single record",
  },
];

/**
 * Screen a researcher's plain-English question for intent, BEFORE it is
 * compiled. Unlike `checkQuery` this does not demand SQL syntax — "How many
 * patients by sex?" is a fine aggregate ask — it only rejects questions that
 * mention identifiers or ask for row-level records. The compiled SQL is then
 * re-checked with `checkQuery` (defense in depth), so this screen is about
 * intent, not proof of aggregation.
 */
export async function checkQuestion(
  question: string,
  datasetId: string,
  opts: AiOptions = {},
): Promise<PrivacyVerdict> {
  const verdict = screenQuestion(question);
  // A deterministic denial is final; Claude is only consulted to add one.
  if (!verdict.allowed || !(opts.useLlm ?? llmEnabled())) return verdict;
  try {
    const review = await reviewQuestion(question, opts);
    if (!review.allowed) {
      return {
        allowed: false,
        reasons: [`Privacy review: ${review.reason}`],
      };
    }
  } catch (err) {
    console.warn(
      `privacy-guard: LLM review failed for ${datasetId}, using rule verdict (${(err as Error).message})`,
    );
  }
  return verdict;
}

const Review = z.object({ allowed: z.boolean(), reason: z.string() });
export type QuestionReview = z.infer<typeof Review>;

const REVIEW_SYSTEM =
  "You screen questions a researcher wants answered from a medical dataset. " +
  "Only aggregate statistics over groups are permitted. Deny (allowed=false) " +
  "if the question asks for row-level records, tries to infer facts about " +
  "a specific or identifiable individual, or narrows to a likely tiny group " +
  "via quasi-identifier combinations (e.g. rare diagnosis + small region + " +
  "exact age or date). Allow ordinary cohort-level counts, averages, and " +
  "breakdowns. reason: one short sentence a researcher can act on.";

/**
 * Claude's second-opinion screen for re-identification risk. Throws on any
 * LLM failure; callers treat that as "no extra opinion".
 */
export async function reviewQuestion(
  question: string,
  opts: Pick<AiOptions, "client"> = {},
): Promise<QuestionReview> {
  const raw = await structured({
    system: REVIEW_SYSTEM,
    prompt: `Question: ${question}`,
    schema: Review,
    client: opts.client,
  });
  return Review.parse(raw);
}

// The deterministic intent screen behind checkQuestion.
function screenQuestion(question: string): PrivacyVerdict {
  const reasons: string[] = [];
  const q = question.toLowerCase();

  // Identifier mentions, in column form ("date_of_birth") or spoken form
  // ("date of birth"), with an optional plural ("names", "emails").
  for (const col of PII_COLUMNS) {
    const spoken = col.replace(/_/g, "[ _]");
    const re = new RegExp(`(^|[^a-z0-9_])${spoken}(e?s)?([^a-z0-9_]|$)`);
    if (re.test(q)) {
      reasons.push(`Question mentions a PII/identifier field: "${col}".`);
    }
  }

  for (const { re, label } of ROW_LEVEL_PHRASES) {
    if (re.test(q)) {
      reasons.push(
        `Question asks for row-level data (${label}); only aggregate ` +
          "questions are permitted.",
      );
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

// Reasons that mean the asker wants one person, not a cohort. No aggregate
// rephrasing preserves that intent, so we offer none rather than a mismatch.
const SINGLE_PERSON_RE = /single record|individual|LIMIT 1/;

// First whitelisted field named in the question, on word boundaries.
function mentioned<T extends string>(q: string, fields: readonly T[]) {
  return fields.find((f) =>
    new RegExp(`\\b${f.replace(/_/g, "[ _]")}\\b`).test(q),
  );
}

/**
 * Suggest an aggregate-only rephrasing of a refused question, or null when no
 * safe rewrite fits (the ask was about one person, or the refusal came from
 * the model review with nothing for us to rewrite from). The suggestion is
 * built only from whitelisted fields and is itself run through the intent
 * screen, so it can never be a question we would refuse.
 */
export function suggestRewrite(
  question: string,
  reasons: string[],
): string | null {
  if (reasons.length === 0) return null;
  if (reasons.every((r) => r.startsWith("Privacy review:"))) return null;
  if (reasons.some((r) => SINGLE_PERSON_RE.test(r))) return null;

  const q = question.toLowerCase();
  // An identifier-based grouping ("by zip") is coarsened to region.
  const group =
    mentioned(q, GROUP_FIELDS) ??
    (/\b(zip|zipcode|postal|address)\b/.test(q) ? "region" : undefined);
  const field = mentioned(q, NUMERIC_FIELDS);
  const wantsAvg = /\b(average|avg|mean)\b/.test(q);

  const by = group ? ` by ${group.replace(/_/g, " ")}` : "";
  const suggestion =
    wantsAvg && field
      ? `What is the average ${field}${by}?`
      : group
        ? `How many patients are there${by}?`
        : "How many patients are in the dataset?";
  return screenQuestion(suggestion).allowed ? suggestion : null;
}

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
