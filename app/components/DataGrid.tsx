"use client";

// Thin client-side wrapper around AG Grid (v36, Theming API).
//
// AG Grid 33+ requires explicit module registration and uses the Theming API
// instead of imported CSS. We register the community bundle once and pick a
// light/dark Quartz theme that follows the OS `prefers-color-scheme`, so the
// grid matches the site's automatic dark mode.
import { useSyncExternalStore } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  colorSchemeDark,
  colorSchemeLight,
  type ColDef,
} from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const lightTheme = themeQuartz.withPart(colorSchemeLight);
const darkTheme = themeQuartz.withPart(colorSchemeDark);

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
  /** Fired with the clicked row's data (used to pick a dataset match). */
  onRowClicked?: (row: T) => void;
  /** Stable row id accessor; enables selection highlighting across renders. */
  getRowId?: (row: T) => string;
  /** id of the currently selected row, for highlight styling. */
  selectedRowId?: string;
  height?: number;
}

export default function DataGrid<T>({
  rowData,
  columnDefs,
  onRowClicked,
  getRowId,
  selectedRowId,
  height = 320,
}: DataGridProps<T>) {
  const dark = usePrefersDark();

  return (
    <div style={{ height, width: "100%" }}>
      <AgGridReact<T>
        theme={dark ? darkTheme : lightTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        defaultColDef={{ flex: 1, minWidth: 100, resizable: true, sortable: true }}
        getRowId={getRowId ? (p) => getRowId(p.data) : undefined}
        rowClass={onRowClicked ? "cursor-pointer" : undefined}
        rowClassRules={
          getRowId && selectedRowId
            ? { "dg-row-selected": (p) => !!p.data && getRowId(p.data) === selectedRowId }
            : undefined
        }
        onRowClicked={onRowClicked ? (e) => e.data && onRowClicked(e.data) : undefined}
      />
    </div>
  );
}
