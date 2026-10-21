// Per-query pricing.
//
// Every answered /api/query call is metered against the buyer's order at this
// flat fee. POST /api/billing (via lib/db/usage) re-exports this same constant,
// so server-side metering and the billing endpoint always agree on price.
// Rejected or suppressed queries are never billed.

/** Flat fee (cents) charged per successfully answered query. */
export const PER_QUERY_FEE_CENTS = 50;
