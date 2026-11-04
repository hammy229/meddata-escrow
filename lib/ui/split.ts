// Pure helpers behind the dispute panel.

/** Read a dollar figure as what the vendor keeps, or say why it won't work. */
export function parseSplit(
  usd: string,
  amountCents: number,
):
  | { ok: true; captureCents: number; refundCents: number }
  | { ok: false; error: string } {
  const n = Number(usd);
  const captureCents = Math.round(n * 100);
  if (usd.trim() === "" || !Number.isFinite(n) || captureCents < 1)
    return { ok: false, error: "Enter what the vendor keeps, above $0." };
  if (captureCents >= amountCents)
    return {
      ok: false,
      error: "A split has to leave something for the buyer.",
    };
  return { ok: true, captureCents, refundCents: amountCents - captureCents };
}

export type OfferView =
  | { kind: "none" }
  | { kind: "mine"; captureCents: number; refundCents: number }
  | { kind: "theirs"; captureCents: number; refundCents: number };

/** What the viewer can do with the order's current offer. */
export function offerView(
  order: {
    amount_cents: number;
    split_offer_cents?: number | null;
    split_offer_by?: string | null;
  },
  role: "researcher" | "vendor",
): OfferView {
  const offer = order.split_offer_cents;
  if (offer === null || offer === undefined) return { kind: "none" };
  return {
    kind: order.split_offer_by === role ? "mine" : "theirs",
    captureCents: offer,
    refundCents: order.amount_cents - offer,
  };
}
