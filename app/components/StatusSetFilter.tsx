"use client";

// AG Grid (Community) custom filter for the ledger's status column: a checkbox
// per escrow state, any combination. The grid owns the model (null = off); the
// logic lives in lib/ui/status-filter so it can be tested without a browser.
import { useCallback } from "react";
import { useGridFilter, type CustomFilterProps } from "ag-grid-react";
import type { IDoesFilterPassParams } from "ag-grid-community";
import {
  STATUS_OPTIONS,
  describeModel,
  statusPasses,
  toModel,
  toggleStatus,
  type StatusSetModel,
} from "../../lib/ui/status-filter";

export default function StatusSetFilter({
  model,
  onModelChange,
  getValue,
}: CustomFilterProps<unknown, unknown, StatusSetModel>) {
  const selected = model?.statuses ?? [];

  const doesFilterPass = useCallback(
    ({ node }: IDoesFilterPassParams) => statusPasses(model, getValue(node)),
    [model, getValue],
  );
  useGridFilter({
    doesFilterPass,
    getModelAsString: (m: StatusSetModel | null) => describeModel(m),
  });

  return (
    <fieldset className="min-w-44 p-3 text-sm">
      <legend className="sr-only">Filter by status</legend>
      <ul className="space-y-1.5">
        {STATUS_OPTIONS.map((status) => (
          <li key={status}>
            <label className="flex cursor-pointer items-center gap-2 font-mono text-xs">
              <input
                type="checkbox"
                checked={selected.includes(status)}
                onChange={() =>
                  onModelChange(toModel(toggleStatus(selected, status)))
                }
                className="h-3.5 w-3.5 accent-pp-600"
              />
              {status}
            </label>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onModelChange(null)}
        disabled={selected.length === 0}
        className="mt-3 text-xs text-pp-700 hover:underline disabled:cursor-not-allowed disabled:opacity-40 dark:text-pp-400"
      >
        Clear
      </button>
    </fieldset>
  );
}
