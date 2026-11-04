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

/**
 * One line about what happens if nobody acts, from the `deadline` field of
 * GET /api/orders?id=. Null when there is no deadline.
 */
export function describeDeadline(deadline: unknown): string | null {
  if (!deadline || typeof deadline !== "object") return null;
  const d = deadline as Record<string, unknown>;
  if (typeof d.daysLeft !== "number") return null;
  const when =
    d.daysLeft === 0
      ? "today"
      : `in ${d.daysLeft} ${d.daysLeft === 1 ? "day" : "days"}`;
  if (d.action === "release")
    return `Payment releases to the vendor ${when} unless you dispute`;
  if (d.action === "refund")
    return `You get your money back ${when} if the vendor doesn't deliver`;
  return null;
}

export interface Delivery {
  url: string;
  expiresAt: string;
  mock: boolean;
}

/** The `delivery` field of GET /api/orders?id=, or null if absent or odd. */
export function parseDelivery(raw: unknown): Delivery | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  if (typeof d.url !== "string" || d.url === "") return null;
  if (typeof d.expiresAt !== "string" || d.expiresAt === "") return null;
  return { url: d.url, expiresAt: d.expiresAt, mock: d.mock === true };
}

/** Button text for the download link, with the local expiry time (HH:MM). */
export function downloadLabel(delivery: Delivery): string {
  const d = new Date(delivery.expiresAt);
  if (Number.isNaN(d.getTime())) return "Download dataset";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Download dataset (link expires ${hh}:${mm})`;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export interface CapView {
  label: string;
  reached: boolean;
  message: string | null;
}

/** "x of cap used" plus a clear message once the query cap is hit. */
export function describeCap(
  spentCents: unknown,
  capCents: unknown,
): CapView | null {
  if (typeof capCents !== "number" || !(capCents > 0)) return null;
  const spent = typeof spentCents === "number" ? spentCents : 0;
  const reached = spent >= capCents;
  return {
    label: `${usd(spent)} of ${usd(capCents)} used`,
    reached,
    message: reached
      ? "Query cap reached. This order cannot run more queries."
      : null,
  };
}

/** Link that reopens an order in the researcher workspace. */
export function workspaceUrl(orderId: string): string {
  return `/researcher?orderId=${encodeURIComponent(orderId)}`;
}
