// Pure helpers that keep the researcher workspace in step with the server's
// order row. No I/O, so node:test covers them.

// The escrow lifecycle, in order. VOIDED, DISPUTED and CANCELLED are off-ramps
// shown as extra chips rather than steps.
export const ESCROW_FLOW = [
  "MATCHED",
  "AUTHORIZED",
  "DELIVERED",
  "CAPTURED",
  "PAID_OUT",
] as const;
export type EscrowFlowState = (typeof ESCROW_FLOW)[number];

export interface OrderView {
  escrow: EscrowFlowState | null;
  voided: boolean;
  disputed: boolean;
  cancelled: boolean;
}

function isFlowState(s: string): s is EscrowFlowState {
  return (ESCROW_FLOW as readonly string[]).includes(s);
}

/**
 * What the workspace should show for a server-side order status. A dispute
 * can start from AUTHORIZED or DELIVERED and the row does not say which, so
 * pass the step already on screen as `previous` to keep it.
 */
export function orderToView(
  status: string,
  previous: EscrowFlowState | null = null,
): OrderView {
  const base = { voided: false, disputed: false, cancelled: false };
  if (isFlowState(status)) return { ...base, escrow: status };
  switch (status) {
    case "DISPUTED":
      return {
        ...base,
        disputed: true,
        escrow: previous === "DELIVERED" ? "DELIVERED" : "AUTHORIZED",
      };
    case "VOIDED":
      return { ...base, voided: true, escrow: "AUTHORIZED" };
    case "CANCELLED":
      return { ...base, cancelled: true, escrow: "MATCHED" };
    default:
      return { ...base, escrow: null };
  }
}

const SETTLED: ReadonlySet<string> = new Set([
  "PAID_OUT",
  "VOIDED",
  "CANCELLED",
]);

/** Keep polling the server only while the order can still change. */
export function shouldPoll(status: string | null | undefined): boolean {
  return typeof status === "string" && status !== "" && !SETTLED.has(status);
}

function shortDate(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * One line about the PayPal hold from the `authorization` field of
 * GET /api/orders?id=. Null when there is no hold or the data is unusable.
 */
export function describeHold(auth: unknown): string | null {
  if (!auth || typeof auth !== "object") return null;
  const a = auth as Record<string, unknown>;
  if (a.state === "expired") {
    return "Hold expired · reauthorize before capturing";
  }
  if (a.state !== "honor" && a.state !== "valid") return null;
  if (typeof a.daysLeft !== "number") return null;
  const honor = shortDate(a.honorUntil);
  if (!honor) return null;
  const days = `${a.daysLeft} ${a.daysLeft === 1 ? "day" : "days"} left`;
  const tail =
    a.state === "honor"
      ? `honor period ends ${honor}`
      : `honor period ended ${honor}`;
  return `Funds held · ${days} · ${tail}`;
}

/** Link that reopens an order in the researcher workspace. */
export function workspaceUrl(orderId: string): string {
  return `/researcher?orderId=${encodeURIComponent(orderId)}`;
}
