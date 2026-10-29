// Pure logic behind the ledger's status checkbox filter (StatusSetFilter).
// The filter model is the set of statuses to keep; null means "no filter",
// which is also what AG Grid expects for an inactive filter.
import { ESCROW_STATES } from "../escrow/state-machine";

export interface StatusSetModel {
  statuses: string[];
}

/** Statuses in lifecycle order, as offered by the checkbox list. */
export const STATUS_OPTIONS: readonly string[] = ESCROW_STATES;

/** Add `status` to the selection, or remove it if already there. */
export function toggleStatus(
  selected: readonly string[],
  status: string,
): string[] {
  return selected.includes(status)
    ? selected.filter((s) => s !== status)
    : [...selected, status];
}

/** A model for `selected`, or null when nothing is ticked (filter off). */
export function toModel(selected: readonly string[]): StatusSetModel | null {
  return selected.length === 0 ? null : { statuses: [...selected] };
}

/** Does a row with this status pass the model? Null passes everything. */
export function statusPasses(
  model: StatusSetModel | null,
  status: unknown,
): boolean {
  if (!model) return true;
  return typeof status === "string" && model.statuses.includes(status);
}

/** Short text for the floating filter, e.g. "AUTHORIZED, VOIDED". */
export function describeModel(model: StatusSetModel | null): string {
  if (!model) return "";
  const ordered = STATUS_OPTIONS.filter((s) => model.statuses.includes(s));
  return ordered.join(", ");
}
