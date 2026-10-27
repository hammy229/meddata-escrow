"use client";

// Answer panel for a privacy-safe query (researcher step 4). Explains how the
// answer was computed — who planned it, the plan as chips, the plain-English
// explanation and the exact aggregate SQL — then shows the rows in an AG Grid
// with numeric formatting and a Community CSV export.
import { useMemo, useRef } from "react";
import type { ColDef } from "ag-grid-community";
import type { AgGridReact } from "ag-grid-react";
import DataGrid from "./DataGrid";
import { SourceBadge } from "./MatchesGrid";
import { Download } from "./icons";

export type AggregateRow = Record<string, string | number>;

export interface QueryPlan {
  op: "count" | "avg" | "min" | "max";
  field: string | null;
  groupBy: string | null;
}

export interface CompiledQuery {
  sql: string;
  plan?: QueryPlan;
  explanation?: string;
  source?: "llm" | "keyword";
}

const OP_LABEL: Record<QueryPlan["op"], string> = {
  count: "Count",
  avg: "Average",
  min: "Minimum",
  max: "Maximum",
};

function humanize(name: string): string {
  const s = name.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// "avg_age" -> "Average age", "count" -> "Count", "group" -> "Region".
function headerFor(key: string, plan?: QueryPlan): string {
  if (key === "group") return plan?.groupBy ? humanize(plan.groupBy) : "Group";
  const m = /^(count|avg|min|max)(?:_(.+))?$/.exec(key);
  if (m) {
    const op = OP_LABEL[m[1] as QueryPlan["op"]];
    return m[2] ? `${op} ${m[2].replace(/_/g, " ")}` : op;
  }
  return humanize(key);
}

const numberFmt = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg border border-rule bg-paper px-2.5 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
        {value}
      </span>
    </span>
  );
}

export default function QueryResult({
  compiled,
  rows,
  fileStem,
}: {
  compiled: CompiledQuery | null;
  rows: AggregateRow[] | null;
  /** Base name for the exported CSV, e.g. the dataset id. */
  fileStem: string;
}) {
  const gridRef = useRef<AgGridReact<AggregateRow>>(null);
  const plan = compiled?.plan;

  // Columns follow the returned row's keys (a grouped average shows its mean
  // column, a scalar shows one value). Numbers are right-aligned, mono and
  // locale-formatted on screen, but export raw so the CSV stays numeric.
  const columns = useMemo<ColDef<AggregateRow>[]>(() => {
    const first = rows?.[0] ?? {};
    return Object.keys(first).map((key) => {
      const numeric = typeof first[key] === "number";
      return numeric
        ? {
            field: key,
            headerName: headerFor(key, plan),
            type: "numericColumn",
            filter: "agNumberColumnFilter",
            cellClass: "font-mono tabular-nums",
            useValueFormatterForExport: false,
            valueFormatter: (p) =>
              typeof p.value === "number" ? numberFmt.format(p.value) : "",
          }
        : {
            field: key,
            headerName: headerFor(key, plan),
            flex: 2,
            filter: "agTextColumnFilter",
          };
    });
  }, [rows, plan]);

  function exportCsv() {
    gridRef.current?.api.exportDataAsCsv({
      fileName: `${fileStem}-query.csv`,
    });
  }

  if (!compiled && !rows) return null;

  return (
    <div className="reveal mt-4 space-y-4">
      {compiled && (
        <div className="rounded-[3px] border border-rule bg-foreground/[0.025] p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="mr-1 text-sm font-semibold">
              How this was computed
            </h3>
            {compiled.source && (
              <SourceBadge
                ai={compiled.source === "llm"}
                aiLabel="Planned by Claude"
                fallbackLabel="Keyword planner"
              />
            )}
          </div>
          {compiled.explanation && (
            <p className="mt-2 text-sm text-zinc-700 dark:text-zinc-300">
              {compiled.explanation}
            </p>
          )}
          {plan && (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Query plan">
              <Chip label="Operation" value={OP_LABEL[plan.op] ?? plan.op} />
              {plan.field && <Chip label="Field" value={plan.field} />}
              <Chip label="Grouped by" value={plan.groupBy ?? "none"} />
            </div>
          )}
          <pre className="mt-3 overflow-x-auto rounded-lg border border-rule bg-paper p-3 font-mono text-xs text-zinc-700 dark:text-zinc-300">
            {compiled.sql}
          </pre>
        </div>
      )}

      {rows && (
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">
              {rows.length} row{rows.length === 1 ? "" : "s"}
            </p>
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-[3px] border border-ink/25 px-3 py-1.5 text-xs text-ink transition-colors hover:border-ink active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
          <DataGrid<AggregateRow>
            gridRef={gridRef}
            rowData={rows}
            columnDefs={columns}
            height={Math.min(60 + Math.max(rows.length, 1) * 46, 380)}
          />
        </div>
      )}
    </div>
  );
}
