// What a vendor may do to an order, derived from the escrow state machine so
// the UI can never offer a move the server would refuse (409).
import { can, isEscrowState } from "../escrow/state-machine";

export type VendorActionId = "deliver" | "refund" | "payout";

export interface VendorAction {
  id: VendorActionId;
  label: string;
  /** PATCH /api/orders body fields for this action. */
  action: "deliver" | "resolve" | "payout";
  resolution?: "void";
}

/** Vendor moves legal from `status`, in display order. Unknown status: none. */
export function vendorActionsFor(status: unknown): VendorAction[] {
  if (!isEscrowState(status)) return [];
  const out: VendorAction[] = [];
  if (can(status, "DELIVER")) {
    out.push({ id: "deliver", label: "Deliver data", action: "deliver" });
  }
  if (can(status, "PAYOUT")) {
    out.push({ id: "payout", label: "Collect payout", action: "payout" });
  }
  // A vendor can settle a dispute only by refunding the buyer. Releasing the
  // money is the buyer's call, so nobody rules on their own dispute.
  if (can(status, "RESOLVE_VOID")) {
    out.push({
      id: "refund",
      label: "Refund buyer",
      action: "resolve",
      resolution: "void",
    });
  }
  return out;
}

/** Does this order wait on the vendor? Drives the "Needs action" filter. */
export function needsAction(status: unknown): boolean {
  return vendorActionsFor(status).length > 0;
}
