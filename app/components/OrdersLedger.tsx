"use client";

// Vendor order ledger: every order in a filterable AG Grid (Community only).
// IncomingOrders above it is the action queue; this is the book of record —
// floating column filters (status text, amount number, created date), a quick
// filter, pagination, CSV export, and a pinned total row that always reflects
// the rows currently passing the filters. Polls GET /api/orders on the same
// 5s cadence as IncomingOrders. The vendor's column layout, sort and filters
// persist in localStorage, with a "Reset view" escape hatch.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  ColDef,
  GridApi,
  GridState,
  ProcessCellForExportParams,
} from "ag-grid-community";
import type { AgGridReact, CustomCellRendererProps } from "ag-grid-react";
import DataGrid from "./DataGrid";
import { Download, Search } from "./icons";

// Mirrors lib/db/client OrderRow (raw DB rows from GET /api/orders). Kept
// local so this client component never imports the server-only db module.
interface OrderRow {
  id: string;
  dataset_id: string;
  buyer_email: string;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string | null;
}

const POLL_MS = 5000;

// SQLite CURRENT_TIMESTAMP is UTC without a zone ("2026-10-21 12:00:00").
function parseTs(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts.includes("Z") || ts.includes("T") ? ts : `${ts}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function relative(ms: number, now = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} d ago`;
}

// Escrow state -> a subtle dot color. The state name is always shown as
// text, so the color is only a scanning aid.
const STATUS_DOT: Record<string, string> = {
  MATCHED: "bg-zinc-400",
  AUTHORIZED: "bg-pp-400",
  DELIVERED: "bg-pp-500",
  CAPTURED: "bg-pp-700 dark:bg-pp-300",
  PAID_OUT: "bg-emerald-500",
  DISPUTED: "bg-amber-500",
  VOIDED: "bg-rose-500",
  CANCELLED: "bg-rose-500",
};

function StatusCell({ value, node }: CustomCellRendererProps<OrderRow>) {
  if (node.rowPinned || typeof value !== "string") return null;
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs">
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[value] ?? "bg-zinc-400"}`}
      />
      {value}
    </span>
  );
}

// Day-level comparison for the created_at date filter: equal when the order
// was created on the picked local date.
function compareDay(filterMidnight: Date, cell: unknown): number {
  if (!(cell instanceof Date)) return -1;
  const day = new Date(cell.getFullYear(), cell.getMonth(), cell.getDate());
  return day.getTime() - filterMidnight.getTime();
}

// CSV gets machine-readable timestamps instead of on-screen relative text.
function exportCell(p: ProcessCellForExportParams<OrderRow>): string {
  const id = p.column.getColId();
  if (id === "created" || id === "updated") {
    const v = p.value;
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number") return new Date(v).toISOString();
    return "";
  }
  if (id === "amount_cents" && typeof p.value === "number") {
    return (p.value / 100).toFixed(2);
  }
  return p.value == null ? "" : String(p.value);
}

// The vendor's saved ledger layout: column order, widths, visibility, sort and
// filters, in this browser's localStorage. Storage can be missing or throw
// (private mode, blocked site data, SSR), so every access is guarded and the
// grid simply starts from its defaults.
const VIEW_KEY = "meddata-escrow:vendor-ledger-view:v1";

function readView(): GridState | undefined {
  try {
    const raw = window.localStorage.getItem(VIEW_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as GridState)
      : undefined;
  } catch {
    return undefined;
  }
}

function writeView(state: GridState): void {
  const { columnOrder, columnSizing, columnVisibility, sort, filter } = state;
  try {
    window.localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({
        columnOrder,
        columnSizing,
        columnVisibility,
        sort,
        filter,
      }),
    );
  } catch {
    // Storage unavailable or full: the view just won't persist.
  }
}

const noopSubscribe = () => () => {};

function clearView(): void {
  try {
    window.localStorage.removeItem(VIEW_KEY);
  } catch {
    // Nothing to clear.
  }
}

// Stable identity (see DataGrid): the 5s poll re-renders this component, and
// a new defaultColDef each time would reset the user's sort and widths.
const LEDGER_COL_DEF: ColDef<OrderRow> = {
  flex: 1,
  minWidth: 110,
  resizable: true,
  sortable: true,
  floatingFilter: true,
};

const toolBtn =
  "inline-flex items-center gap-1.5 rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900";

interface Totals {
  count: number;
  cents: number;
}

export default function OrdersLedger() {
  const gridRef = useRef<AgGridReact<OrderRow>>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const [totals, setTotals] = useState<Totals>({ count: 0, cents: 0 });
  // Saved layout, read once per grid mount (initialState is init-only), and a
  // key bumped by "Reset view" to remount the grid with its defaults.
  const [savedView, setSavedView] = useState<GridState | undefined>(readView);
  const [gridKey, setGridKey] = useState(0);
  const [customized, setCustomized] = useState(() => savedView !== undefined);
  // False on the server and during hydration, so the button's markup matches
  // before localStorage is consulted.
  const hydrated = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

  function resetView() {
    clearView();
    setSavedView(undefined);
    setCustomized(false);
    setGridKey((k) => k + 1);
  }

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/orders", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Order service responded ${res.status}.`);
        return;
      }
      setOrders(Array.isArray(data.orders) ? data.orders : []);
      setError(null);
    } catch {
      setError("Could not reach the order service.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load]);

  // Rows that did not change keep their cells, so re-render the relative
  // "updated" column on every poll to keep "2 min ago" honest.
  useEffect(() => {
    gridRef.current?.api?.refreshCells({ columns: ["updated"], force: true });
  }, [orders]);

  // Sum only the rows passing the current filters (column + quick filter).
  const recomputeTotals = useCallback((api: GridApi<OrderRow>) => {
    let count = 0;
    let cents = 0;
    api.forEachNodeAfterFilter((n) => {
      if (!n.data) return;
      count += 1;
      cents += n.data.amount_cents || 0;
    });
    setTotals((prev) =>
      prev.count === count && prev.cents === cents ? prev : { count, cents },
    );
  }, []);

  const pinnedBottom = useMemo(
    () => [
      {
        id: "Total",
        dataset_id: `${totals.count} order${totals.count === 1 ? "" : "s"}`,
        buyer_email: "",
        status: "",
        amount_cents: totals.cents,
        created_at: "",
        updated_at: null,
      } satisfies OrderRow,
    ],
    [totals],
  );

  const columns = useMemo<ColDef<OrderRow>[]>(
    () => [
      {
        field: "id",
        headerName: "Order",
        minWidth: 170,
        cellClass: "font-mono text-xs",
        filter: "agTextColumnFilter",
        tooltipField: "id",
      },
      {
        field: "dataset_id",
        headerName: "Dataset",
        minWidth: 190,
        filter: "agTextColumnFilter",
        tooltipField: "dataset_id",
      },
      {
        field: "buyer_email",
        headerName: "Buyer",
        minWidth: 190,
        filter: "agTextColumnFilter",
        tooltipField: "buyer_email",
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 150,
        filter: "agTextColumnFilter",
        cellRenderer: StatusCell,
      },
      {
        field: "amount_cents",
        headerName: "Amount",
        minWidth: 130,
        type: "rightAligned",
        cellClass: "font-mono tabular-nums",
        filter: "agNumberColumnFilter",
        // Filter in dollars, the unit shown in the cell.
        filterValueGetter: (p) =>
          typeof p.data?.amount_cents === "number"
            ? p.data.amount_cents / 100
            : null,
        valueFormatter: (p) =>
          typeof p.value === "number" ? usd(p.value) : "",
      },
      {
        colId: "created",
        headerName: "Created",
        minWidth: 190,
        initialSort: "desc",
        filter: "agDateColumnFilter",
        filterParams: { comparator: compareDay },
        valueGetter: (p) => parseTs(p.data?.created_at),
        valueFormatter: (p) =>
          p.value instanceof Date
            ? p.value.toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              })
            : "",
      },
      {
        colId: "updated",
        headerName: "Updated",
        minWidth: 130,
        filter: false,
        cellClass: "text-zinc-500",
        valueGetter: (p) =>
          parseTs(p.data?.updated_at ?? p.data?.created_at)?.getTime() ?? null,
        valueFormatter: (p) =>
          typeof p.value === "number" ? relative(p.value) : "",
        tooltipValueGetter: (p) =>
          typeof p.value === "number"
            ? new Date(p.value).toLocaleString(undefined, {
                dateStyle: "full",
                timeStyle: "long",
              })
            : null,
      },
    ],
    [],
  );

  function exportCsv() {
    gridRef.current?.api.exportDataAsCsv({
      fileName: "meddata-orders.csv",
      processCellCallback: exportCell,
      // The pinned total is a UI summary, not an order: keep it out of the
      // export so every CSV row is a real ledger entry.
      skipPinnedBottom: true,
    });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search orders</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="search"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            placeholder="Search orders, buyers, datasets…"
            className="w-full rounded-full border border-zinc-300 bg-white py-1.5 pl-9 pr-3 text-sm outline-none transition-colors focus:border-pp-500 focus:ring-4 focus:ring-pp-500/15 dark:border-zinc-700 dark:bg-zinc-950"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-500">
            {totals.count} of {orders.length} shown
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={orders.length === 0}
            className={toolBtn}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={resetView}
            disabled={!hydrated || !customized}
            title="Restore the default columns, sort and filters"
            className={toolBtn}
          >
            Reset view
          </button>
        </div>
      </div>

      {error && (
        <p
          role="alert"
          className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {error}
        </p>
      )}

      <DataGrid<OrderRow>
        key={gridKey}
        gridRef={gridRef}
        rowData={orders}
        columnDefs={columns}
        getRowId={(r) => r.id}
        height={560}
        options={{
          loading,
          quickFilterText: quick,
          defaultColDef: LEDGER_COL_DEF,
          pagination: true,
          paginationAutoPageSize: true,
          pinnedBottomRowData: pinnedBottom,
          getRowClass: (p) => (p.node.rowPinned ? "ledger-total" : undefined),
          localeText: { noRowsToShow: "No orders yet" },
          onFilterChanged: (e) => recomputeTotals(e.api),
          onRowDataUpdated: (e) => recomputeTotals(e.api),
          onFirstDataRendered: (e) => recomputeTotals(e.api),
          initialState: savedView,
          // Persist only user changes, not the grid's own initialization.
          onStateUpdated: (e) => {
            if (e.sources.includes("gridInitializing")) return;
            writeView(e.state);
            setCustomized(true);
          },
        }}
      />
    </div>
  );
}
