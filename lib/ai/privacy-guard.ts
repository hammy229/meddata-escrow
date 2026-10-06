// Privacy guard.
// Enforces that queries and their results only ever expose privacy-safe
// aggregates (e.g. small-cell suppression, minimum group sizes) and never
// row-level records. Raw records never leave the vendor.
// Placeholder — no logic yet.

export interface PrivacyVerdict {
  allowed: boolean;
  reasons: string[];
}

export async function checkQuery(
  _query: string,
  _datasetId: string,
): Promise<PrivacyVerdict> {
  // TODO: reject row-level requests, enforce minimum aggregation thresholds.
  throw new Error("checkQuery not implemented");
}

export async function checkResult(_rows: unknown[]): Promise<PrivacyVerdict> {
  // TODO: apply small-cell suppression before returning aggregates.
  throw new Error("checkResult not implemented");
}
