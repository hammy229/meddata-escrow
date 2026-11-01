// Money columns for the vendor ledger. Every row is split with the marketplace
// fee policy (what the platform keeps and the vendor nets if the order is
// captured), so amount === fee + net on every row and in the totals.
import { platformFeeCents, vendorPayoutCents } from "../escrow/fees";

/** id of the pinned summary row; never counted as an order. */
export const TOTAL_ID = "Total";

export interface LedgerMoneyRow {
  id: string;
  amount_cents: number;
}

export interface LedgerTotals {
  count: number;
  amountCents: number;
  feeCents: number;
  netCents: number;
}

/** Sum the real orders in `rows`; the pinned total row is skipped. */
export function ledgerTotals(rows: readonly LedgerMoneyRow[]): LedgerTotals {
  const t: LedgerTotals = {
    count: 0,
    amountCents: 0,
    feeCents: 0,
    netCents: 0,
  };
  for (const r of rows) {
    if (r.id === TOTAL_ID) continue;
    const amount = r.amount_cents || 0;
    t.count += 1;
    t.amountCents += amount;
    t.feeCents += platformFeeCents(amount);
    t.netCents += vendorPayoutCents(amount);
  }
  return t;
}
