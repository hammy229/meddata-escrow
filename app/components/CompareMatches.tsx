"use client";

// Side-by-side view of up to three picked matches (researcher step 2). The
// best value in each numeric row gets a check and a heavier weight, so the
// winner never relies on color alone.
import { compareRows, type Comparable } from "../../lib/ui/compare";
import { Check } from "./icons";

export default function CompareMatches({
  picks,
  onChoose,
}: {
  picks: Comparable[];
  /** Choose one of the compared datasets for purchase. */
  onChoose: (datasetId: string) => void;
}) {
  if (picks.length < 2) return null;
  const rows = compareRows(picks);

  return (
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="sr-only">Comparison of selected datasets</caption>
        <thead>
          <tr className="border-b border-rule text-left">
            <th scope="col" className="w-32 py-2 pr-4 font-normal text-muted">
              Compare
            </th>
            {picks.map((m) => (
              <th
                key={m.datasetId}
                scope="col"
                className="py-2 pr-4 align-top font-medium"
              >
                {m.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-rule align-top">
              <th
                scope="row"
                className="py-2.5 pr-4 text-left font-normal text-muted"
              >
                {row.label}
              </th>
              {row.cells.map((cell, i) => (
                <td
                  key={picks[i].datasetId}
                  className={`py-2.5 pr-4 ${row.key === "why" ? "text-muted" : "font-mono tabular-nums"} ${cell.best ? "font-semibold text-pp-800 dark:text-pp-300" : ""}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {cell.best && <Check className="h-3.5 w-3.5" />}
                    {cell.text}
                    {cell.best && <span className="sr-only"> (best)</span>}
                  </span>
                </td>
              ))}
            </tr>
          ))}
          <tr>
            <td />
            {picks.map((m) => (
              <td key={m.datasetId} className="py-3 pr-4">
                <button
                  type="button"
                  onClick={() => onChoose(m.datasetId)}
                  className="rounded-[3px] border border-ink/25 px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink active:translate-y-px"
                >
                  Choose this one
                </button>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
