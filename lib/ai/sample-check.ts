// Sample quality + privacy check — the gate between PayPal authorization and
// capture in the escrow flow (README step 3): capture only if the sample passes.
//
// MOCK VENDOR SAMPLE: there is no real vendor data in this demo, so
// `sampleProfile` synthesizes a deterministic profile of a vendor sample from
// the dataset's catalog entry (seeded by its id): per-field completeness,
// duplicate-row rate, identifier columns seen, synthetic flag, record count.
// A real vendor would compute the same profile over an actual sample on its
// side; nothing here touches records.
//
// Two reviewers over that one profile:
//   - rules (always): fixed thresholds in `rulesVerdict`.
//   - Claude on Bedrock (when enabled): reviews the profile against the
//     study's needs. Like the privacy screen, it can only TIGHTEN — passed is
//     rules AND Claude, and the score never exceeds the rules score. Any LLM
//     failure falls back to the rules verdict.
import * as z from "zod/v4";

import { llmEnabled, structured } from "../llm/client";
import { loadCatalog, type CatalogEntry } from "./matcher";
import type { AiOptions } from "./options";

export interface SampleProfile {
  datasetId: string;
  recordCount: number;
  sampleSize: number;
  syntheticData: boolean;
  tags: string[];
  /** Percent of sampled rows with a non-null value, per field. */
  fieldCompletenessPct: Record<string, number>;
  duplicateRowPct: number;
  /** Direct-identifier columns found in the sample (must be empty). */
  identifierColumns: string[];
}

export interface SampleCheck {
  passed: boolean;
  score: number;
  findings: string[];
  source: "llm" | "rules";
}

/** Below this many records a cohort is too small to be worth buying. */
export const MIN_RECORDS = 1000;
/** Every profiled field must be at least this complete. */
export const MIN_COMPLETENESS_PCT = 90;
export const MAX_DUPLICATE_PCT = 2;
/** Tags a listing must carry; "synthetic" is our stand-in for verified de-identification. */
export const REQUIRED_TAGS = ["synthetic"];

const PROFILED_FIELDS = ["age", "sex", "region", "diagnosis", "year", "value"];
const SAMPLE_SIZE = 200;

// FNV-1a, so the mock profile is stable across runs without randomness.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic mock profile of a vendor sample for a catalog entry. */
export function sampleProfile(entry: CatalogEntry): SampleProfile {
  const fieldCompletenessPct = Object.fromEntries(
    PROFILED_FIELDS.map((f) => [f, 90 + (hash(`${entry.id}:${f}`) % 11)]),
  );
  return {
    datasetId: entry.id,
    recordCount: entry.recordCount,
    sampleSize: Math.min(SAMPLE_SIZE, entry.recordCount),
    syntheticData: entry.tags.includes("synthetic"),
    tags: entry.tags,
    fieldCompletenessPct,
    duplicateRowPct: (hash(`${entry.id}:dup`) % 15) / 10,
    identifierColumns: [],
  };
}

/** Fixed-threshold verdict over a profile. Pure. */
export function rulesVerdict(p: SampleProfile): SampleCheck {
  const checks: [boolean, string][] = [];
  checks.push([
    p.recordCount >= MIN_RECORDS,
    `record count ${p.recordCount} (minimum ${MIN_RECORDS})`,
  ]);
  const worst = Object.entries(p.fieldCompletenessPct).sort(
    (a, b) => a[1] - b[1],
  )[0];
  checks.push([
    !worst || worst[1] >= MIN_COMPLETENESS_PCT,
    worst
      ? `least complete field "${worst[0]}" at ${worst[1]}% (minimum ${MIN_COMPLETENESS_PCT}%)`
      : "no fields profiled",
  ]);
  checks.push([
    p.duplicateRowPct <= MAX_DUPLICATE_PCT,
    `duplicate rows ${p.duplicateRowPct}% (maximum ${MAX_DUPLICATE_PCT}%)`,
  ]);
  const missingTags = REQUIRED_TAGS.filter((t) => !p.tags.includes(t));
  checks.push([
    missingTags.length === 0,
    missingTags.length
      ? `missing required tags: ${missingTags.join(", ")}`
      : `required tags present (${REQUIRED_TAGS.join(", ")})`,
  ]);
  checks.push([
    p.syntheticData,
    p.syntheticData
      ? "sample is flagged synthetic"
      : "sample is not flagged synthetic",
  ]);
  checks.push([
    p.identifierColumns.length === 0,
    p.identifierColumns.length
      ? `identifier columns in sample: ${p.identifierColumns.join(", ")}`
      : "no identifier columns in sample",
  ]);

  const ok = checks.filter(([pass]) => pass).length;
  const completeness = Object.values(p.fieldCompletenessPct);
  const avg = completeness.length
    ? completeness.reduce((a, b) => a + b, 0) / completeness.length
    : 0;
  return {
    passed: ok === checks.length,
    score: Math.round((avg * ok) / checks.length),
    findings: checks.map(([pass, msg]) => `${pass ? "PASS" : "FAIL"}: ${msg}`),
    source: "rules",
  };
}

const Review = z.object({
  passed: z.boolean(),
  score: z.number().min(0).max(100),
  findings: z.array(z.string()),
});

const REVIEW_SYSTEM =
  "You review a profile of a vendor's sample of a medical research dataset " +
  "before the buyer's escrow payment is captured. Judge data quality " +
  "(completeness, duplicates, size) and privacy (no identifiers) against " +
  "the study's needs. passed=false if the data is unfit or unsafe. score " +
  "0-100. findings: short, specific bullet sentences.";

export interface SampleCheckOptions extends AiOptions {
  /** The buyer's study description, so Claude can judge fitness for purpose. */
  studyDescription?: string;
}

/**
 * Check a dataset's (mock) vendor sample. Throws if the dataset id is not in
 * the catalog.
 */
export async function checkSample(
  datasetId: string,
  opts: SampleCheckOptions = {},
): Promise<SampleCheck> {
  const entry = loadCatalog().find((d) => d.id === datasetId);
  if (!entry) throw new Error(`unknown dataset: ${datasetId}`);
  const profile = sampleProfile(entry);
  const rules = rulesVerdict(profile);
  if (!(opts.useLlm ?? llmEnabled())) return rules;

  try {
    const raw = await structured({
      system: REVIEW_SYSTEM,
      prompt:
        `Study needs: ${opts.studyDescription?.trim() || "(not given)"}\n\n` +
        `Dataset: ${entry.title}\n` +
        `Sample profile (JSON):\n${JSON.stringify(profile)}`,
      schema: Review,
      client: opts.client,
    });
    const review = Review.parse(raw);
    const ruleFailures = rules.findings.filter((f) => f.startsWith("FAIL"));
    return {
      passed: rules.passed && review.passed,
      score: Math.round(Math.min(review.score, rules.score)),
      findings: [...review.findings, ...ruleFailures],
      source: "llm",
    };
  } catch (err) {
    console.warn(
      `sample-check: LLM review failed, using rules verdict (${(err as Error).message})`,
    );
    return rules;
  }
}
