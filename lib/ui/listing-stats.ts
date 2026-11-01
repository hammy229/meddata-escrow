// Per-listing performance for the vendor catalog: how many orders a dataset
// has had, what is still held in escrow, and what the vendor has earned net
// of the platform fee (computed with the same fee policy as payouts).
import { platformFeeCents, vendorPayoutCents } from "../escrow/fees";

export interface StatOrder {
  dataset_id: string;
  status: string;
  amount_cents: number;
  created_at: string;
}

export interface ListingStats {
  orders: number;
  /** AUTHORIZED + DELIVERED + DISPUTED: PayPal still holds the funds. */
  inEscrowCents: number;
  /** CAPTURED + PAID_OUT gross. */
  capturedCents: number;
  /** Vendor's share of capturedCents. netCents + feeCents === capturedCents. */
  netCents: number;
  feeCents: number;
  /** created_at of the newest order, or null. */
  lastOrderAt: string | null;
}

const HELD = new Set(["AUTHORIZED", "DELIVERED", "DISPUTED"]);
const CAPTURED = new Set(["CAPTURED", "PAID_OUT"]);

/** Stats keyed by dataset id; datasets with no orders are absent. */
export function listingStats(
  orders: readonly StatOrder[],
): Map<string, ListingStats> {
  const out = new Map<string, ListingStats>();
  for (const o of orders) {
    let s = out.get(o.dataset_id);
    if (!s) {
      s = {
        orders: 0,
        inEscrowCents: 0,
        capturedCents: 0,
        netCents: 0,
        feeCents: 0,
        lastOrderAt: null,
      };
      out.set(o.dataset_id, s);
    }
    s.orders += 1;
    if (HELD.has(o.status)) s.inEscrowCents += o.amount_cents;
    if (CAPTURED.has(o.status)) {
      s.capturedCents += o.amount_cents;
      s.netCents += vendorPayoutCents(o.amount_cents);
      s.feeCents += platformFeeCents(o.amount_cents);
    }
    if (s.lastOrderAt === null || o.created_at > s.lastOrderAt) {
      s.lastOrderAt = o.created_at;
    }
  }
  return out;
}
