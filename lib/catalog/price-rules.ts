// Pricing rules for dataset listings, shared by the datasets API and any UI
// that wants to pre-check an entry. Prices are whole cents, $1 to $10,000.

/** Lowest listing price: $1.00. */
export const MIN_PRICE_CENTS = 100;
/** Highest listing price: $10,000.00. */
export const MAX_PRICE_CENTS = 1_000_000;

export type PriceCheck =
  { ok: true; priceCents: number } | { ok: false; error: string };

/** Check an untrusted value; the error text is safe to show to the vendor. */
export function checkPriceCents(value: unknown): PriceCheck {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return { ok: false, error: "priceCents must be a whole number of cents" };
  }
  if (value < MIN_PRICE_CENTS || value > MAX_PRICE_CENTS) {
    return {
      ok: false,
      error: `priceCents must be between ${MIN_PRICE_CENTS} ($1.00) and ${MAX_PRICE_CENTS} ($10,000.00)`,
    };
  }
  return { ok: true, priceCents: value };
}

/**
 * Dollars typed in the catalog grid -> cents to send. Rounds away float noise
 * (19.99 * 100 = 1998.9999999999998) but leaves a genuine fraction of a cent
 * as a non-integer, so the API rejects it instead of silently rounding.
 */
export function dollarsToCents(dollars: number): number {
  const cents = dollars * 100;
  const rounded = Math.round(cents);
  return Math.abs(cents - rounded) < 1e-6 ? rounded : cents;
}
