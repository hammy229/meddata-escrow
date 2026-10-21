"use client";

// Thin client-side wrapper around AG Grid (v36, Theming API).
//
// AG Grid 33+ requires explicit module registration and uses the Theming API
// instead of imported CSS. We register the community bundle once and pick a
// light/dark Quartz theme that follows the OS `prefers-color-scheme`, so the
// grid matches the site's automatic dark mode. Richer grids pass extra grid
// options through `options` and reach the API through `gridRef`.
import { useSyncExternalStore, type Ref } from "react";
import { AgGridReact, type AgGridReactProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  colorSchemeDark,
  colorSchemeLight,
  type ColDef,
} from "ag-grid-community";

// AllCommunityModule covers everything the app's grids use: quick filter,
// text/number/date filters, row selection, pagination, pinned rows, tooltips,
// CSV export and grid state. No Enterprise modules.
ModuleRegistry.registerModules([AllCommunityModule]);

// Match the grid to the site: PayPal-blue accent, Hanken/JetBrains fonts, zinc
// borders, generous row height, and a soft wrapper radius.
const shared = {
  accentColor: "#0070e0",
  fontFamily: "var(--font-sans)",
  cellFontFamily: "var(--font-sans)",
  headerFontWeight: 600,
  rowHeight: 46,
  headerHeight: 46,
  wrapperBorderRadius: 12,
  fontSize: 14,
};

const lightTheme = themeQuartz.withPart(colorSchemeLight).withParams({
  ...shared,
  borderColor: "#e4e4e7",
  headerBackgroundColor: "#fafafa",
  rowHoverColor: "color-mix(in srgb, #0070e0 7%, transparent)",
  selectedRowBackgroundColor: "color-mix(in srgb, #0070e0 14%, transparent)",
});
const darkTheme = themeQuartz.withPart(colorSchemeDark).withParams({
  ...shared,
  backgroundColor: "#0c0c0f",
  borderColor: "#27272a",
  headerBackgroundColor: "#131316",
  rowHoverColor: "color-mix(in srgb, #0070e0 12%, transparent)",
  selectedRowBackgroundColor: "color-mix(in srgb, #0070e0 24%, transparent)",
});

// Subscribe to the OS color-scheme via useSyncExternalStore (SSR-safe: the
// server snapshot is always light, then the client reconciles on hydration).
const DARK_QUERY = "(prefers-color-scheme: dark)";
function subscribeScheme(onChange: () => void): () => void {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeScheme,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

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
  const dark = usePrefersDark();

  return (
    <div style={{ height, width: "100%" }}>
      <AgGridReact<T>
        ref={gridRef}
        theme={dark ? darkTheme : lightTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={{
          flex: 1,
          minWidth: 100,
          resizable: true,
          sortable: true,
        }}
        tooltipShowDelay={250}
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        rowClass={onRowClicked ? "cursor-pointer" : undefined}
        rowClassRules={
          getRowId && selectedRowId
            ? {
                "dg-row-selected": (p) =>
                  !!p.data && getRowId(p.data) === selectedRowId,
              }
            : undefined
        }
        onRowClicked={
          onRowClicked ? (e) => e.data && onRowClicked(e.data) : undefined
        }
        {...options}
      />
    </div>
  );
}
