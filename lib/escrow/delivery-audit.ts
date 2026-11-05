// Check the data a vendor delivered against what the listing claimed.
//
// Money is blocked by one thing only: a breach of a claim the listing made
// (subject count, record count, event rate, coverage, no post-index features,
// unique subjects). Confounding or weak power alone is a warning. A listing
// that claimed nothing about leakage or repeated subjects is not blocked for
// them. This is a screen, not proof; the fingerprint shows which bytes were
// audited and nothing more.
//
// The synthetic listings carry a seeded fixture; the delivered rows are that
// fixture's delivery stage. A listing without a fixture is not audited and
// behaves exactly as it did before audits existed.
import type { AppDatabase } from "../db/connection";
import { transaction } from "../db/connection";
import {
  advanceOrder,
  saveDeliveryAudit,
  type NewDeliveryAudit,
  type OrderRow,
} from "../db/store";
import { runFitnessAudit } from "../fitness/audit";
import { verdictOf } from "../fitness/common";
import { checkDrift } from "../fitness/drift";
import { fingerprintRows } from "../fitness/fingerprint";
import { fixtureCohort, fixtureSpec, listingClaims } from "../fitness/source";
import type { DeliveryAudit } from "../fitness/types";
import { AUDIT_NOTE_PREFIX } from "./audit-note";

export { AUDIT_NOTE_PREFIX };

/** What the delivered data is screened for: the same study the sample was. */
const DELIVERY_STUDY = "Predict survival from baseline FVC and age at onset";

export interface AuditSummary {
  verdict: DeliveryAudit["verdict"];
  blocking: boolean;
}

/** Audit the rows delivered for an order, or null if the listing has none to check. */
export function auditDelivery(order: {
  id: string;
  dataset_id: string;
}): NewDeliveryAudit | null {
  const cohort = fixtureCohort(order.dataset_id, "delivery");
  if (!cohort) return null;
  const claims = listingClaims(order.dataset_id);
  const base = { orderId: order.id, datasetId: order.dataset_id, claims };
  try {
    const report = runFitnessAudit({
      datasetId: order.dataset_id,
      stage: "delivery",
      synthetic: cohort.synthetic,
      study: DELIVERY_STUDY,
      subjects: cohort.subjects,
      visits: cohort.visits,
      featureTiming: cohort.featureTiming,
      claims,
    });
    // Drift from the sample the buyer checked. Warn only; it never blocks money.
    const sample = fixtureCohort(order.dataset_id, "sample");
    if (sample && report.verdict !== "not_applicable") {
      report.findings.push(...checkDrift(sample.subjects, cohort.subjects, { ignore: ["subject_key"] }));
      report.verdict = verdictOf(report.findings);
    }
    const fingerprint = fingerprintRows({
      subjects: cohort.subjects,
      visits: cohort.visits,
    });
    if (report.verdict === "not_applicable")
      return { ...base, verdict: "inconclusive", blocking: false, fingerprint, report };
    const blocking = report.findings.some(
      (f) => f.id === "claim" && f.severity === "fail",
    );
    return { ...base, verdict: report.verdict, blocking, fingerprint, report };
  } catch {
    // The screen could not run. Say so; do not guess in either direction.
    return { ...base, verdict: "inconclusive", blocking: false, fingerprint: null, report: null };
  }
}

export function auditSummary(audit: NewDeliveryAudit | null): AuditSummary {
  return audit
    ? { verdict: audit.verdict, blocking: audit.blocking }
    : { verdict: "not_applicable", blocking: false };
}

type StoredVerdict = Pick<DeliveryAudit, "verdict" | "blocking">;

/**
 * Why a person must look before a capture, or null. Only a breach of a listing
 * claim stops a capture; an inconclusive audit does not stop a person.
 */
export function captureBlockReason(audit: StoredVerdict | undefined): string | null {
  return audit?.blocking
    ? "The delivery audit found data that breaks the listing, so the payment is held for a person to decide."
    : null;
}

/**
 * Why a payment must not be released automatically, or null. Software never
 * releases money on an audit that failed, could not decide, or is missing for a
 * dataset that is audited.
 */
export function releaseBlockReason(
  datasetId: string,
  audit: StoredVerdict | undefined,
): string | null {
  if (audit?.blocking) return captureBlockReason(audit);
  if (audit?.verdict === "inconclusive")
    return "The delivery audit could not reach a verdict, so a person has to decide.";
  if (!audit && fixtureSpec(datasetId) !== null)
    return "This dataset is audited and no delivery audit is on file, so a person has to decide.";
  return null;
}

function disputeNote(audit: NewDeliveryAudit): string {
  const breaches =
    audit.report?.findings.filter(
      (f) => f.id === "claim" && f.severity === "fail",
    ).length ?? 0;
  return (
    `${AUDIT_NOTE_PREFIX} the delivered data breaks ${breaches} claim${breaches === 1 ? "" : "s"} in the listing. ` +
    "A person decides what happens next."
  );
}

/**
 * Record the audit, mark the order delivered and, when the audit blocks, open
 * the dispute, all in one transaction. Call it with the audit already computed:
 * nothing slow or nested happens while the transaction is open.
 */
export async function applyDelivery(
  db: AppDatabase,
  orderId: string,
  audit: NewDeliveryAudit | null,
  note?: string,
): Promise<{ delivered: OrderRow; disputed?: OrderRow }> {
  return transaction(db, async () => {
    if (audit) await saveDeliveryAudit(db, audit);
    const delivered = await advanceOrder(db, orderId, "DELIVER", undefined, note);
    if (!audit?.blocking) return { delivered };
    const disputed = await advanceOrder(
      db,
      orderId,
      "DISPUTE",
      undefined,
      disputeNote(audit),
    );
    return { delivered, disputed };
  });
}
