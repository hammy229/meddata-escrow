// A SHA-256 over the exact rows that were audited. It shows which bytes the
// audit looked at and nothing more: it does not show the data is correct, and a
// different fingerprint only says the rows differ.
//
// Server only (node:crypto). Keep this out of anything a client bundle imports.
import { createHash } from "node:crypto";

import type { Row } from "./common";

/** Floats are rounded so arithmetic noise (0.1 + 0.2) cannot change the hash. */
const DECIMALS = 6;

function canonicalValue(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number")
    return Number.isFinite(v) ? v.toFixed(DECIMALS) : `num:${String(v)}`;
  if (typeof v === "boolean") return v ? "true" : "false";
  // Strings are quoted so the text "null" differs from a missing value.
  return JSON.stringify(String(v));
}

function canonicalRow(row: Row): string {
  const record = row as Record<string, unknown>;
  return Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalValue(record[k])}`)
    .join(",");
}

/** Fingerprint named tables of rows. Row order counts; column order does not. */
export function fingerprintRows(tables: Record<string, readonly Row[]>): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(tables).sort()) {
    hash.update(`table ${JSON.stringify(name)} ${tables[name].length}\n`, "utf8");
    for (const row of tables[name]) hash.update(`${canonicalRow(row)}\n`, "utf8");
  }
  return hash.digest("hex");
}
