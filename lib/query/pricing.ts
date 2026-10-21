// Per-query pricing.
//
// Every answered /api/query call is metered against the buyer's order at this
// flat fee. It matches the default fee POST /api/billing applies when no
// chargeCents is given, so server-side metering and the manual billing endpoint
// agree on price. Rejected or suppressed queries are never billed.

/** Flat fee (cents) charged per successfully answered query. */
export const PER_QUERY_FEE_CENTS = 50;
