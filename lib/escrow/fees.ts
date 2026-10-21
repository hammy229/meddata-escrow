// Marketplace fee policy: how a captured escrow amount splits between the
// vendor and the platform when the vendor is paid out.
//
// PLATFORM_FEE_BPS is the platform's take in basis points (1000 = 10%). The
// fee is rounded to the nearest cent and the vendor receives the remainder, so
// vendor + fee always equals the captured amount exactly (no lost cents).

/** Platform fee in basis points: 1000 bps = 10% of the captured amount. */
export const PLATFORM_FEE_BPS = 1000;

/** The platform's fee on `amountCents`, rounded to the nearest cent. */
export function platformFeeCents(amountCents: number): number {
  return Math.round((amountCents * PLATFORM_FEE_BPS) / 10_000);
}

/** What the vendor is paid for a captured order of `amountCents`. */
export function vendorPayoutCents(amountCents: number): number {
  return amountCents - platformFeeCents(amountCents);
}
