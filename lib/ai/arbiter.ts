// Dispute arbiter: ADVISORY recommendation for a DISPUTED order.
//
// HARD RULE: this module only advises. It imports nothing that can move money
// (no escrow service, no PayPal, no DB writes) and every result carries
// `advisoryOnly: true`. A human (or the vendor/buyer via the normal resolve
// action) still has to act. `enforceAdvisory` additionally forces
// "needs_human" whenever confidence is below MIN_CONFIDENCE, whichever
// reviewer produced the answer.
//
// Two reviewers over the same evidence (audit trail with notes, the sample
// check, delivery data):
//   - rules (always available, deterministic): used in mock mode and as the
//     fallback if the LLM errors or returns something off-schema.
//   - Claude on Bedrock (LLM_PROVIDER=bedrock): schema-validated output.
import * as z from "zod/v4";

import { llmEnabled, structured } from "../llm/client";
import type { AiOptions } from "./options";
import type { SampleCheck } from "./sample-check";

export const OUTCOMES = ["refund", "release", "split", "needs_human"] as const;
export type ArbiterOutcome = (typeof OUTCOMES)[number];

/** Below this confidence the recommendation is forced to needs_human. */
export const MIN_CONFIDENCE = 0.6;

export interface ArbiterEvent {
  event: string;
  seq: number;
  note: string | null;
  created_at: string;
}

export interface ArbiterInput {
  order: {
    id: string;
    status: string;
    amount_cents: number;
    dataset_id: string;
  };
  /** The order's audit trail, oldest first. */
  events: ArbiterEvent[];
  /** Sample-check evidence, or null if unavailable. */
  sample: SampleCheck | null;
}

export interface Recommendation {
  outcome: ArbiterOutcome;
  /** 0..1. */
  confidence: number;
  rationale: string;
  evidence: string[];
  source: "llm" | "rules";
  /** Always true: the arbiter never moves money. */
  advisoryOnly: true;
}

const PRIVACY = /re-?identif|privacy|hipaa|\bphi\b|identif(y|ier)|\bssn\b/i;
const QUALITY =
  /missing|duplicate|incomplete|wrong|corrupt|empty|inaccurate|stale|outdated|quality|null|mismatch/i;

/** Clamp confidence and force needs_human when it is too low. Pure. */
export function enforceAdvisory(rec: Recommendation): Recommendation {
  const confidence = Number.isFinite(rec.confidence)
    ? Math.min(1, Math.max(0, rec.confidence))
    : 0;
  const base = { ...rec, confidence, advisoryOnly: true as const };
  if (confidence < MIN_CONFIDENCE && rec.outcome !== "needs_human") {
    return {
      ...base,
      outcome: "needs_human",
      rationale:
        `Confidence ${confidence.toFixed(2)} is below the ${MIN_CONFIDENCE} floor, ` +
        `so this goes to a human. Model leaned ${rec.outcome}: ${rec.rationale}`,
    };
  }
  if (confidence < MIN_CONFIDENCE) return { ...base, outcome: "needs_human" };
  return base;
}

function rules(input: ArbiterInput): Recommendation {
  const { events, sample } = input;
  const delivered = events.some((e) => e.event === "DELIVER");
  const complaint = events
    .filter((e) => e.event === "DISPUTE" && e.note)
    .map((e) => e.note as string)
    .join(" ")
    .trim();
  const evidence: string[] = [
    delivered
      ? "Audit trail shows the data was delivered."
      : "Audit trail shows the data was never delivered.",
    complaint
      ? `Buyer's dispute note: "${complaint}"`
      : "Buyer gave no dispute note.",
  ];
  if (sample) {
    evidence.push(
      `Sample check ${sample.passed ? "passed" : "failed"} (score ${sample.score}).`,
      ...sample.findings
        .filter((f) => !sample.passed || f.startsWith("FAIL"))
        .slice(0, 5),
    );
  } else {
    evidence.push("No sample check evidence is available for this dataset.");
  }
  const done = (
    outcome: ArbiterOutcome,
    confidence: number,
    rationale: string,
  ): Recommendation => ({
    outcome,
    confidence,
    rationale,
    evidence,
    source: "rules",
    advisoryOnly: true,
  });

  if (!delivered)
    return done(
      "refund",
      0.9,
      "The vendor never delivered the data, so the buyer should get the held funds back.",
    );
  if (!sample)
    return done(
      "needs_human",
      0.4,
      "Delivery happened but there is no sample check to judge quality against, so a person should review.",
    );
  if (!sample.passed)
    return done(
      "refund",
      0.85,
      "The sample check failed on listed quality or privacy rules, which supports the buyer's complaint.",
    );
  if (PRIVACY.test(complaint))
    return done(
      "needs_human",
      0.4,
      "The complaint raises a privacy or re-identification concern that automated rules should not decide.",
    );
  if (QUALITY.test(complaint))
    return done(
      "split",
      0.65,
      "The sample check passed but the buyer reports a concrete quality problem, so a partial remedy looks fairest.",
    );
  if (complaint)
    return done(
      "needs_human",
      0.45,
      "The sample check passed but the complaint is not one the rules can classify.",
    );
  return done(
    "release",
    0.75,
    "Data was delivered, the sample check passed and the buyer gave no specific complaint, so the vendor should be paid.",
  );
}

const Answer = z.object({
  outcome: z.enum(OUTCOMES),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidence: z.array(z.string()),
});

const SYSTEM =
  "You advise on a disputed escrow order for a medical research dataset. " +
  "Funds are held by PayPal; you NEVER move money, you only recommend. " +
  "Outcomes: refund (buyer wins), release (vendor wins), split (partial " +
  "remedy), needs_human (unclear, risky or privacy related). Base the answer " +
  "only on the evidence given. confidence is 0 to 1; be honest, low " +
  "confidence is fine. evidence: short sentences quoting the facts used.";

/**
 * Recommend an outcome for a disputed order. Never throws on LLM trouble: any
 * failure or off-schema answer falls back to the rules. Always advisory.
 */
export async function arbitrate(
  input: ArbiterInput,
  opts: AiOptions = {},
): Promise<Recommendation> {
  if (!(opts.useLlm ?? llmEnabled())) return enforceAdvisory(rules(input));
  try {
    const raw = await structured({
      system: SYSTEM,
      prompt:
        `Order ${input.order.id} (${input.order.amount_cents} cents, dataset ${input.order.dataset_id}).\n\n` +
        `Audit trail (JSON):\n${JSON.stringify(input.events)}\n\n` +
        `Sample check (JSON):\n${JSON.stringify(input.sample)}`,
      schema: Answer,
      client: opts.client,
    });
    const a = Answer.parse(raw);
    return enforceAdvisory({ ...a, source: "llm", advisoryOnly: true });
  } catch (err) {
    console.warn(
      `arbiter: LLM failed, using rules (${(err as Error).message})`,
    );
    return enforceAdvisory(rules(input));
  }
}
