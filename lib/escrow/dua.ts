// Data Use Agreement generated per order. Pure and deterministic: the same
// inputs always give the same text and SHA-256 fingerprint, so a buyer and a
// vendor (or an auditor later) can re-derive the hash from the order and prove
// which terms applied. The timestamp is the order's creation time, not "now",
// for exactly that reason.
import { createHash } from "node:crypto";

export interface DuaInput {
  orderId: string;
  datasetId: string;
  datasetTitle: string;
  vendorName: string;
  buyerEmail: string;
  amountCents: number;
  /** Order creation time as stored (ISO or SQLite "YYYY-MM-DD HH:MM:SS"). */
  issuedAt: string;
}

export interface Dua {
  text: string;
  sha256: string;
}

/** One line, no control characters: free-text fields cannot add clauses. */
function oneLine(s: string): string {
  // Control characters and Unicode line/paragraph separators become spaces.
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    out += c < 0x20 || c === 0x7f || c === 0x2028 || c === 0x2029 ? " " : ch;
  }
  return out.replace(/ {2,}/g, " ").trim();
}

function dollars(cents: number): string {
  const whole = Math.trunc(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${whole}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
}

export function generateDua(input: DuaInput): Dua {
  const text = [
    "DATA USE AGREEMENT",
    "",
    "PARTIES",
    `Vendor: ${oneLine(input.vendorName)}`,
    `Buyer: ${oneLine(input.buyerEmail)}`,
    "",
    "ORDER",
    `Order ID: ${oneLine(input.orderId)}`,
    `Dataset: ${oneLine(input.datasetTitle)} (${oneLine(input.datasetId)})`,
    `Escrowed amount: ${dollars(input.amountCents)}`,
    `Issued: ${oneLine(input.issuedAt)}`,
    "",
    "PERMITTED USE",
    "The Buyer may use the dataset only for the research purpose described",
    "when the order was matched, and only for the Buyer's own analysis.",
    "The dataset may not be resold, sublicensed or shared with third parties.",
    "",
    "NO RE-IDENTIFICATION",
    "The Buyer will not attempt to re-identify any individual, link records to",
    "other data sources to identify an individual, or contact anyone who may",
    "appear in the data. Any accidental identification must be reported to the",
    "Vendor and the data deleted.",
    "",
    "AGGREGATE-ONLY OUTPUT",
    "Results, publications and exports may contain aggregate statistics only.",
    "Small cell counts that could single out a person must be suppressed.",
    "",
    "RETENTION",
    "The Buyer will delete the dataset and any derived row-level copies within",
    "30 days of completing the research, or on request if the order is",
    "refunded or voided.",
    "",
    "ESCROW AND DISPUTES",
    "Payment is held in escrow and released only after delivery and sample",
    "checks. Either party may dispute the order before capture; a dispute",
    "recommendation is advisory and does not move funds on its own.",
    "",
    "This text and its SHA-256 fingerprint are recorded on the order receipt.",
    "",
  ].join("\n");
  const sha256 = createHash("sha256").update(text, "utf8").digest("hex");
  return { text, sha256 };
}
