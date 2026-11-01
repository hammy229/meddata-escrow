// What a vendor may do to an order, derived from the escrow state machine so
// the UI can never offer a move the server would refuse (409).
import { can, isEscrowState } from "../escrow/state-machine";

export type VendorActionId = "release" | "refund";

export interface VendorAction {
  id: VendorActionId;
  label: string;
  /** PATCH /api/orders body fields for this action. */
  action: "resolve";
  resolution: "capture" | "void";
}

/** Vendor moves legal from `status`, in display order. Unknown status: none. */
export function vendorActionsFor(status: unknown): VendorAction[] {
  if (!isEscrowState(status)) return [];
  const out: VendorAction[] = [];
  if (can(status, "RESOLVE_CAPTURE")) {
    out.push({
      id: "release",
      label: "Release to vendor",
      action: "resolve",
      resolution: "capture",
    });
  }
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
