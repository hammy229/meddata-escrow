// Pure helpers behind the agent spending panel.

/** Mirrors lib/agent/mandate-store MandateSummary for client components. */
export interface MandateRow {
  id: string;
  maxTotalCents: number;
  maxPerOrderCents: number;
  spentCents: number;
  remainingCents: number;
  status: "active" | "expired" | "revoked";
  expiresAt: string;
}

export interface MandateForm {
  totalUsd: string;
  perOrderUsd: string;
  hours: number;
}

export type MandateBody =
  | {
      ok: true;
      body: {
        maxTotalCents: number;
        maxPerOrderCents: number;
        expiresAt: string;
      };
    }
  | { ok: false; error: string };

function cents(usd: string): number | null {
  const n = Number(usd);
  if (usd.trim() === "" || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

/** Turn the form's dollars into a POST /api/mandates body, or say what's wrong. */
export function mandateBody(
  form: MandateForm,
  now: Date = new Date(),
): MandateBody {
  const maxTotalCents = cents(form.totalUsd);
  if (maxTotalCents === null)
    return { ok: false, error: "Enter a total budget above $0." };
  const maxPerOrderCents = cents(form.perOrderUsd);
  if (maxPerOrderCents === null)
    return { ok: false, error: "Enter a per-order cap above $0." };
  if (maxPerOrderCents > maxTotalCents)
    return {
      ok: false,
      error: "The per-order cap can't be more than the total budget.",
    };
  return {
    ok: true,
    body: {
      maxTotalCents,
      maxPerOrderCents,
      expiresAt: new Date(now.getTime() + form.hours * 3_600_000).toISOString(),
    },
  };
}

/** How full a mandate's bar should be, from 0 to 100. */
export function spentPercent(row: {
  spentCents: number;
  maxTotalCents: number;
}): number {
  if (row.maxTotalCents <= 0) return 0;
  return Math.min(100, Math.round((row.spentCents / row.maxTotalCents) * 100));
}
