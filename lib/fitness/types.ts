// Type-only module. It reaches client bundles, so it must not import anything
// from node: and must not hold runtime values.

export type Severity = "pass" | "warn" | "fail" | "info";
export interface Finding { id: "coverage"|"epv"|"subject_overlap"|"temporal_leak"|"label_association"|"imbalance"|"claim"|"leak_impact";
  severity: Severity; column?: string; title: string; reason: string; metric?: Record<string, number|string>; }
export interface FitnessReport { datasetId: string; stage: "sample"|"delivery"; synthetic: boolean;
  verdict: "pass"|"warn"|"fail"|"not_applicable"; findings: Finding[]; disclaimer: string; methodVersion: 1; }
export interface DeliveryAudit { orderId: string; verdict: "pass"|"warn"|"fail"|"inconclusive"|"not_applicable";
  blocking: boolean; fingerprint: string | null; claims: ListingClaims | null; report: FitnessReport | null; createdAt: string; }
export interface ListingClaims { subjects: number; records: number; eventRatePct: number;
  coveragePct: Record<string, number>; noPostIndexFeatures?: true; uniqueSubjects?: true; }
