"use client";

// Thin client-side wrapper around AG Grid (v36, Theming API).
//
// AG Grid 33+ requires explicit module registration and uses the Theming API
// instead of imported CSS. We register the community bundle once and pick a
// light Quartz theme, since the site is light only (PayPal white). Richer grids pass extra grid
// options through `options` and reach the API through `gridRef`.
import type { Ref } from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  colorSchemeLight,
  type ColDef,
} from "ag-grid-community";

// AllCommunityModule covers everything the app's grids use: quick filter,
// text/number/date filters, row selection, pagination, pinned rows, tooltips,
// CSV export and grid state. No Enterprise modules.
ModuleRegistry.registerModules([AllCommunityModule]);

// Match the grid to the site: the colors are the design tokens from
// globals.css (white page, grey rules, navy ink, PayPal blue accent), read as
// CSS variables so the grid follows the palette without
// its own hex values. Inter Tight text, generous row height, and a
// near-square wrapper.
const shared = {
  accentColor: "var(--accent)",
  foregroundColor: "var(--foreground)",
  textColor: "var(--foreground)",
  backgroundColor: "var(--background)",
  borderColor: "var(--rule)",
  headerBackgroundColor: "var(--surface)",
  headerTextColor: "var(--foreground)",
  rowHoverColor: "color-mix(in srgb, var(--accent) 8%, transparent)",
  selectedRowBackgroundColor:
    "color-mix(in srgb, var(--accent) 16%, transparent)",
  fontFamily: "var(--font-sans)",
  cellFontFamily: "var(--font-sans)",
  headerFontWeight: 500,
  rowHeight: 46,
  headerHeight: 46,
  wrapperBorderRadius: 3,
  fontSize: 14,
};

const lightTheme = themeQuartz.withPart(colorSchemeLight).withParams(shared);
export interface DataGridProps<T> {
  rowData: T[];
  columnDefs: ColDef<T>[];
  /** Fired with the clicked row's data. */
  onRowClicked?: (row: T) => void;
  /** Stable row id accessor; keeps row identity (and selection) across renders. */
  getRowId?: (row: T) => string;
  /** id of the currently selected row, for highlight styling. */
  selectedRowId?: string;
  /** Pixel height, or any CSS length. */
  height?: number | string;
  /** Ref to the grid, for imperative calls such as `api.exportDataAsCsv()`. */
  gridRef?: Ref<AgGridReact<T>>;
  /**
   * Extra AG Grid options (quick filter, row selection, pagination, events…),
   * spread last so they override the wrapper's defaults.
   */
  options?: Omit<AgGridReactProps<T>, "rowData" | "columnDefs" | "theme">;
}

// Module-level so its identity is stable: a fresh object on every render makes
// AG Grid re-apply column defaults (flex, sort) and wipe the user's changes.
const DEFAULT_COL_DEF: ColDef = {
  flex: 1,
  minWidth: 100,
  resizable: true,
  sortable: true,
};

export default function DataGrid<T>({
  rowData,
  columnDefs,
  onRowClicked,
  getRowId,
  selectedRowId,
  height = 320,
  gridRef,
  options,
}: DataGridProps<T>) {
  // The selected-row highlight merges with any rules the caller passes.
  const rowClassRules =
    getRowId && selectedRowId
      ? {
          ...options?.rowClassRules,
          "dg-row-selected": (p: { data?: T }) =>
            !!p.data && getRowId(p.data) === selectedRowId,
        }
      : options?.rowClassRules;

  return (
    <div style={{ height, width: "100%" }}>
      <AgGridReact<T>
        ref={gridRef}
        theme={lightTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        tooltipShowDelay={250}
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        rowClass={onRowClicked ? "cursor-pointer" : undefined}
        onRowClicked={
          onRowClicked ? (e) => e.data && onRowClicked(e.data) : undefined
        }
        {...options}
        {...(rowClassRules ? { rowClassRules } : {})}
      />
    </div>
  );
}
