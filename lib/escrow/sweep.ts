// Escrow deadlines, so a silent party can't leave money stuck.
//
//   DELIVERED   The buyer has INSPECTION_DAYS to confirm or dispute. After that
//               the payment is released to the vendor.
//               Not when the delivery audit blocked, could not decide, or is
//               missing for an audited dataset: a person decides those.
//   AUTHORIZED  The vendor has until the hold is about to expire to deliver.
//               After that the hold is voided and the buyer keeps the money.
//   DISPUTED    Never moved automatically. A dispute needs a decision, so one
//               whose hold is about to expire is only flagged for review.
//
// Everything is a day earlier than PayPal's 29-day limit (see ./auth-window),
// because a capture on an expired authorization fails. Each move goes through
// advanceEscrowOrder, so the state machine and PayPal idempotency keys still
// apply, and a sweep can safely run twice or race with a person clicking.
import {
  getDeliveryAudit,
  listOrderEvents,
  listOrders,
  withDb,
} from "../db/store";
import { releaseBlockReason } from "./delivery-audit";
import { parseTimestamp, VALID_DAYS } from "./auth-window";
import { advanceEscrowOrder, EscrowError, type EscrowDeps } from "./service";

/** How long a buyer has to inspect delivered data. */
export const INSPECTION_DAYS = 7;
const LAST_SAFE_HOLD_DAY = VALID_DAYS - 1;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface EscrowDeadline {
  /** What happens at the deadline if nobody acts. */
  action: "release" | "refund";
  dueAt: string;
  /** Whole days left, rounded up; 0 once due. */
  daysLeft: number;
}

interface TimedEvent {
  event: string;
  created_at: string;
}

function eventTime(events: TimedEvent[], name: string): number | null {
  const at = events.find((e) => e.event === name)?.created_at;
  return at ? (parseTimestamp(at)?.getTime() ?? null) : null;
}

/** The order's deadline, or null if it has none (or its dates can't be read). */
export function escrowDeadline(
  status: string,
  events: TimedEvent[],
  now: Date = new Date(),
  opts: { releaseBlocked?: boolean } = {},
): EscrowDeadline | null {
  const authorized = eventTime(events, "AUTHORIZE");
  const holdEnds =
    authorized === null ? null : authorized + LAST_SAFE_HOLD_DAY * DAY_MS;
  let action: EscrowDeadline["action"];
  let due: number | null;
  if (status === "DELIVERED") {
    // The audit is holding the payment back, so no release is coming.
    if (opts.releaseBlocked) return null;
    const delivered = eventTime(events, "DELIVER");
    if (delivered === null) return null;
    action = "release";
    due = delivered + INSPECTION_DAYS * DAY_MS;
    if (holdEnds !== null) due = Math.min(due, holdEnds);
  } else if (status === "AUTHORIZED") {
    action = "refund";
    due = holdEnds;
  } else {
    return null;
  }
  if (due === null) return null;
  return {
    action,
    dueAt: new Date(due).toISOString(),
    daysLeft: Math.max(0, Math.ceil((due - now.getTime()) / DAY_MS)),
  };
}

export interface SweepResult {
  /** Payment released to the vendor. */
  released: string[];
  /** Hold voided, so the buyer keeps the money. */
  refunded: string[];
  /** Disputes whose hold is about to expire. A person has to decide these. */
  needsReview: string[];
  /** Releases the delivery audit stopped. They wait for a person. */
  blocked: { orderId: string; reason: string }[];
  /** Moves that failed. They stay put and the next sweep tries again. */
  failed: { orderId: string; error: string }[];
}

/** Act on every order past its deadline. One failure never stops the rest. */
export async function sweepEscrow(
  opts: { now?: Date; deps?: EscrowDeps } = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date();
  const result: SweepResult = {
    released: [],
    refunded: [],
    needsReview: [],
    blocked: [],
    failed: [],
  };
  const open = await withDb(async (db) => {
    const rows = [];
    for (const status of ["AUTHORIZED", "DELIVERED", "DISPUTED"] as const)
      for (const order of await listOrders(db, { status }))
        rows.push({
          order,
          events: await listOrderEvents(db, order.id),
          audit: await getDeliveryAudit(db, order.id),
        });
    return rows;
  });
  for (const { order, events, audit } of open) {
    if (order.status === "DISPUTED") {
      const authorized = eventTime(events, "AUTHORIZE");
      if (
        authorized !== null &&
        now.getTime() >= authorized + LAST_SAFE_HOLD_DAY * DAY_MS
      )
        result.needsReview.push(order.id);
      continue;
    }
    const deadline = escrowDeadline(order.status, events, now);
    if (!deadline) {
      result.failed.push({
        orderId: order.id,
        error: "could not work out this order's deadline",
      });
      continue;
    }
    if (now.getTime() < Date.parse(deadline.dueAt)) continue;
    // Checked before any capture, and reported apart from failures: a blocked
    // order is not an error and should not look like one on every run.
    if (deadline.action === "release") {
      const reason = releaseBlockReason(order.dataset_id, audit);
      if (reason) {
        result.blocked.push({ orderId: order.id, reason });
        continue;
      }
    }
    try {
      if (deadline.action === "release") {
        await advanceEscrowOrder(
          {
            orderId: order.id,
            action: "capture",
            note: `Released automatically: the buyer did not respond within ${INSPECTION_DAYS} days of delivery.`,
          },
          opts.deps,
        );
        result.released.push(order.id);
      } else {
        await advanceEscrowOrder(
          {
            orderId: order.id,
            action: "void",
            note: "Refunded automatically: the vendor did not deliver before the hold ran out.",
          },
          opts.deps,
        );
        result.refunded.push(order.id);
      }
    } catch (err) {
      // Someone else's audit landed between the read and the move.
      if (err instanceof EscrowError && err.code === "AUDIT_BLOCKED") {
        result.blocked.push({ orderId: order.id, reason: err.message });
        continue;
      }
      result.failed.push({ orderId: order.id, error: (err as Error).message });
    }
  }
  return result;
}
