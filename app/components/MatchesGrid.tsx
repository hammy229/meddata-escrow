"use client";

// Ranked dataset matches (researcher step 2). Built on the shared DataGrid
// wrapper with Community-only features: a score bar renderer, currency
// formatting, rationale tooltips, a quick-filter box, text/number column
// filters, a click on a row that drives the "pick a match" flow, and checkboxes
// that collect up to three rows for side-by-side comparison.
import { useMemo, useRef, useState } from "react";
import type { ColDef } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import { reconcileCompare } from "../../lib/ui/compare";
import DataGrid from "./DataGrid";
import { Search } from "./icons";

export interface Match {
  datasetId: string;
  score: number;
  rationale: string;
  title: string;
  priceCents: number;
  source?: "llm" | "keyword";
  /** Row count from the catalog, when the match response carries it. */
  recordCount?: number;
}

export type MatchSource = "llm" | "keyword";

// AG Grid's id for the checkbox column.
const SELECTION_COL = "ag-Grid-SelectionColumn";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

interface ScoreParams {
  /** Scale for the bar: 100 for Claude's 0-100 scores, else the top score. */
  max: number;
  source: MatchSource;
}

// Visible number + proportional bar: the number carries the meaning, the bar
// only helps scanning, so nothing depends on color alone.
function ScoreCell(
  props: CustomCellRendererProps<Match, number> & ScoreParams,
) {
  const { value, max, source } = props;
  if (typeof value !== "number") return null;
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const label =
    source === "llm"
      ? `${value} out of 100`
      : `${value} matching term${value === 1 ? "" : "s"}`;
  return (
    <span className="flex h-full items-center gap-2.5" title={label}>
      <span className="w-9 text-right font-mono text-sm font-semibold tabular-nums">
        {value}
        <span className="sr-only">
          {source === "llm" ? " out of 100" : " matching terms"}
        </span>
      </span>
      <span
        aria-hidden="true"
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
      >
        <span
          className="block h-full rounded-full bg-pp-600 dark:bg-pp-400"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

export function SourceBadge({
  ai,
  aiLabel,
  fallbackLabel,
}: {
  ai: boolean;
  aiLabel: string;
  fallbackLabel: string;
}) {
  return (
    <span
      className={
        ai
          ? "inline-flex items-center gap-1.5 rounded-full border border-pp-300 bg-pp-50 px-2.5 py-0.5 text-xs font-medium text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300"
          : "inline-flex items-center gap-1.5 rounded-full border border-rule bg-zinc-50 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
      }
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${ai ? "bg-pp-600 dark:bg-pp-400" : "bg-zinc-400"}`}
      />
      {ai ? aiLabel : fallbackLabel}
    </span>
  );
}

export default function MatchesGrid({
  matches,
  source,
  onSelect,
  onCompareChange,
}: {
  matches: Match[];
  source: MatchSource;
  onSelect: (m: Match) => void;
  /** Called with the ticked rows (at most three, in tick order). */
  onCompareChange?: (picks: Match[]) => void;
}) {
  const [quick, setQuick] = useState("");
  const picked = useRef<string[]>([]);

  const columns = useMemo<ColDef<Match>[]>(() => {
    const top = Math.max(0, ...matches.map((m) => m.score));
    const scoreParams: ScoreParams = {
      max: source === "llm" ? 100 : top,
      source,
    };
    return [
      {
        field: "title",
        headerName: "Dataset",
        flex: 2,
        minWidth: 220,
        filter: "agTextColumnFilter",
        tooltipField: "title",
      },
      {
        field: "score",
        headerName: source === "llm" ? "Match score" : "Terms matched",
        minWidth: 170,
        maxWidth: 220,
        sort: "desc",
        filter: "agNumberColumnFilter",
        cellRenderer: ScoreCell,
        cellRendererParams: scoreParams,
      },
      {
        field: "rationale",
        headerName: "Why it matched",
        flex: 3,
        minWidth: 240,
        filter: "agTextColumnFilter",
        tooltipField: "rationale",
      },
      {
        field: "priceCents",
        headerName: "Price",
        minWidth: 110,
        maxWidth: 130,
        type: "rightAligned",
        cellClass: "font-mono tabular-nums",
        filter: "agNumberColumnFilter",
        // Filter in dollars, the unit the researcher reads.
        filterValueGetter: (p) =>
          typeof p.data?.priceCents === "number"
            ? p.data.priceCents / 100
            : null,
        valueFormatter: (p) =>
          typeof p.value === "number" ? usd(p.value) : "",
      },
    ];
  }, [matches, source]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SourceBadge
          ai={source === "llm"}
          aiLabel="AI-ranked by Claude"
          fallbackLabel="Keyword-ranked"
        />
        <label className="relative block w-full sm:w-64">
          <span className="sr-only">Filter matches</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Filter matches…"
            className="w-full rounded-[3px] border border-ink/20 bg-paper py-1.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-pp-500 focus:ring-2 focus:ring-pp-500/15 dark:border-zinc-700"
          />
        </label>
      </div>
      <DataGrid<Match>
        rowData={matches}
        columnDefs={columns}
        getRowId={(r) => r.datasetId}
        height={Math.min(60 + matches.length * 46, 380)}
        options={{
          quickFilterText: quick,
          tooltipShowMode: "whenTruncated",
          rowClass: "cursor-pointer",
          // Checkboxes only collect rows to compare; a click elsewhere on the
          // row still picks that match for purchase.
          rowSelection: {
            mode: "multiRow",
            checkboxes: true,
            headerCheckbox: false,
            enableClickSelection: false,
          },
          onCellClicked: (e) => {
            if (e.column.getColId() === SELECTION_COL) return;
            if (e.data) onSelect(e.data);
          },
          onSelectionChanged: (e) => {
            const rows = e.api.getSelectedRows();
            const ids = reconcileCompare(
              picked.current,
              rows.map((r) => r.datasetId),
            );
            // A fourth tick is undone straight away.
            const extra = e.api
              .getSelectedNodes()
              .filter((n) => n.data && !ids.includes(n.data.datasetId));
            if (extra.length > 0) {
              e.api.setNodesSelected({ nodes: extra, newValue: false });
              return;
            }
            picked.current = ids;
            onCompareChange?.(
              ids
                .map((id) => matches.find((m) => m.datasetId === id))
                .filter((m): m is Match => !!m),
            );
          },
        }}
      />
    </div>
  );
}
