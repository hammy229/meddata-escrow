// Trust score for a vendor or a dataset: 0-100 from five observable signals,
// each with a plain-English reason. Pure over rows already loaded from the DB
// (see ./load) so it is trivially testable and explainable to a buyer.
//
// Every rate is SHRUNK toward a neutral prior (value = (good + prior*K) /
// (n + K)), so one lucky order cannot look perfect and one unlucky order does
// not look ruinous. A seller earns a top score only with real volume.
export interface TrustEvent {
  order_id: string;
  seq: number;
  event: string;
  /** SQLite CURRENT_TIMESTAMP text, "YYYY-MM-DD HH:MM:SS" (UTC). */
  created_at: string;
}

export interface TrustOrder {
  id: string;
  events: TrustEvent[];
}

export interface TrustInput {
  orders: TrustOrder[];
  /** One entry per sample check run on the subject's datasets (true = pass). */
  sampleChecks: boolean[];
}

export interface TrustFactor {
  key:
    | "sampleChecks"
    | "disputeRate"
    | "disputeOutcomes"
    | "deliverySpeed"
    | "volume";
  label: string;
  /** Points available (all weights sum to 100). */
  weight: number;
  /** 0..1 after shrinkage. */
  value: number;
  /** weight * value, unrounded. */
  points: number;
  reason: string;
}

export type TrustGrade = "A" | "B" | "C" | "D" | "F";

export interface TrustScore {
  score: number;
  grade: TrustGrade;
  factors: TrustFactor[];
}

/** Pseudo-observations of the neutral prior mixed into every rate. */
const SHRINK_K = 4;
const PRIOR = 0.5;
/** Orders needed for the volume factor to reach half credit. */
const VOLUME_HALF = 8;
/** Median delivery at/below FAST earns full speed credit; at/above SLOW, none. */
const FAST_HOURS = 1;
const SLOW_HOURS = 72;

const shrunk = (good: number, n: number) =>
  (good + PRIOR * SHRINK_K) / (n + SHRINK_K);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function toMs(ts: string): number {
  return Date.parse(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function gradeFor(score: number): TrustGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function trustScore(input: TrustInput): TrustScore {
  const total = input.orders.length;
  const has = (o: TrustOrder, ev: string) =>
    o.events.some((e) => e.event === ev);

  // Sample checks.
  const checks = input.sampleChecks.length;
  const passed = input.sampleChecks.filter(Boolean).length;
  const sampleValue = shrunk(passed, checks);
  const sampleReason = checks
    ? `${passed} of ${plural(checks, "sample check")} passed (${pct(passed / checks)}).`
    : "No sample checks on record yet, so this is held at a neutral value.";

  // Dispute rate.
  const disputes = input.orders.filter((o) => has(o, "DISPUTE")).length;
  const rateValue = shrunk(total - disputes, total);
  const rateReason = total
    ? `${disputes} of ${plural(total, "order")} were disputed (${pct(disputes / total)}).`
    : "No orders yet, so the dispute rate is unknown and held at a neutral value.";

  // Dispute outcomes (only resolved disputes count).
  const vendorWon = input.orders.filter((o) =>
    has(o, "RESOLVE_CAPTURE"),
  ).length;
  const buyerWon = input.orders.filter((o) => has(o, "RESOLVE_VOID")).length;
  const splits = input.orders.filter((o) => has(o, "RESOLVE_SPLIT")).length;
  const resolved = vendorWon + buyerWon + splits;
  // A split is a shared outcome, so it counts half for the vendor.
  const outcomeValue = resolved
    ? shrunk(vendorWon + splits / 2, resolved)
    : 0.8;
  const outcomeReason = resolved
    ? `Of ${plural(resolved, "resolved dispute")}, the vendor prevailed in ${vendorWon} and the buyer in ${buyerWon}${splits ? `, and ${splits} ended in a split` : ""}.`
    : "No resolved disputes yet, which counts mildly in the vendor's favor.";

  // Delivery speed: AUTHORIZE -> DELIVER, per delivered order.
  const hours: number[] = [];
  for (const o of input.orders) {
    const a = o.events.find((e) => e.event === "AUTHORIZE");
    const d = o.events.find((e) => e.event === "DELIVER");
    if (!a || !d) continue;
    const h = (toMs(d.created_at) - toMs(a.created_at)) / 3_600_000;
    if (Number.isFinite(h) && h >= 0) hours.push(h);
  }
  let speedValue = PRIOR;
  let speedReason =
    "No delivered orders yet, so speed is held at a neutral value.";
  if (hours.length) {
    const med = median(hours);
    const raw = Math.min(
      1,
      Math.max(0, (SLOW_HOURS - med) / (SLOW_HOURS - FAST_HOURS)),
    );
    speedValue =
      (raw * hours.length + PRIOR * SHRINK_K) / (hours.length + SHRINK_K);
    const shown =
      med < 1 ? `${Math.round(med * 60)} min` : `${med.toFixed(1)} h`;
    speedReason = `Median time from payment authorization to delivery is ${shown} across ${plural(hours.length, "delivered order")}.`;
  }

  // Volume: saturating, so history has to be earned.
  const volumeValue = total / (total + VOLUME_HALF);
  const volumeReason = total
    ? `${plural(total, "order")} placed through escrow; credit grows with volume.`
    : "No orders yet, so no volume credit.";

  const mk = (
    key: TrustFactor["key"],
    label: string,
    weight: number,
    value: number,
    reason: string,
  ): TrustFactor => ({
    key,
    label,
    weight,
    value,
    points: weight * value,
    reason,
  });

  const factors = [
    mk("sampleChecks", "Sample check pass rate", 30, sampleValue, sampleReason),
    mk("disputeRate", "Dispute rate", 25, rateValue, rateReason),
    mk("disputeOutcomes", "Dispute outcomes", 20, outcomeValue, outcomeReason),
    mk("deliverySpeed", "Delivery speed", 15, speedValue, speedReason),
    mk("volume", "Order volume", 10, volumeValue, volumeReason),
  ];
  const score = Math.max(
    0,
    Math.min(100, Math.round(factors.reduce((s, f) => s + f.points, 0))),
  );
  return { score, grade: gradeFor(score), factors };
}
