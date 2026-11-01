"use client";

// Vendor incoming-orders view (client component). Polls GET /api/orders for the
// live order book and shows it in the shared AG Grid. Orders that wait on the
// vendor (see lib/ui/vendor-actions) get action buttons in their row: a
// disputed order can be released to the vendor (resolve: capture) or the buyer
// refunded (resolve: void) via PATCH /api/orders. The server is authoritative
// for the from-state and PayPal ids, so we send nothing but the action.
//
// "Needs action" is an AG Grid external filter. The audit history opens as a
// full-width detail row directly under its order.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ColDef } from "ag-grid-community";
import type { AgGridReact, CustomCellRendererProps } from "ag-grid-react";
import DataGrid from "./DataGrid";
import OrderTimeline from "./OrderTimeline";
import { needsAction, vendorActionsFor } from "../../lib/ui/vendor-actions";

// Mirrors lib/db/client OrderRow (the GET endpoint returns raw DB rows). Kept
// local so this client component never imports the server-only db module.
interface OrderRow {
  id: string;
  dataset_id: string;
  buyer_email: string;
  paypal_order_id: string | null;
  authorization_id: string | null;
  status: string;
  amount_cents: number;
  created_at: string;
  updated_at: string | null;
}

// The grid mixes order rows with full-width detail rows (an open history).
type OrderGridRow = OrderRow & { kind: "order" };
interface DetailRow {
  kind: "detail";
  id: string;
  order: OrderRow;
}
type GridRow = OrderGridRow | DetailRow;

const POLL_MS = 5000;
const ROW_HEIGHT = 56;
const DETAIL_HEIGHT = 300;

// Escrow state -> badge styling. Held/terminal/disputed states get their own
// accent so the book is scannable at a glance.
const STATE_BADGE: Record<string, string> = {
  MATCHED:
    "border-rule bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
  AUTHORIZED:
    "border-pp-300 bg-pp-50 text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300",
  DELIVERED:
    "border-pp-300 bg-pp-50 text-pp-800 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300",
  CAPTURED:
    "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500",
  PAID_OUT:
    "border-pp-600 bg-pp-600 text-white dark:border-pp-500 dark:bg-pp-500",
  DISPUTED:
    "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300",
  VOIDED:
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
  CANCELLED:
    "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300",
};

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function when(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts.includes("Z") || ts.includes("T") ? ts : `${ts}Z`);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function StateBadge({ status }: { status: string }) {
  const cls = STATE_BADGE[status] ?? STATE_BADGE.MATCHED;
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-xs ${cls}`}
    >
      {status}
    </span>
  );
}

const resolveBtn =
  "rounded-[3px] px-3 py-1.5 text-xs transition-colors active:translate-y-px disabled:cursor-not-allowed disabled:opacity-40";

// What the cell renderers need from the component: React context crosses the
// grid's portals, so cells re-render as busy/open state changes.
interface Controls {
  busyId: string | null;
  open: ReadonlySet<string>;
  acted: Record<string, number>;
  resolve: (orderId: string, resolution: "capture" | "void") => void;
  toggleHistory: (orderId: string) => void;
}
const ControlsContext = createContext<Controls>({
  busyId: null,
  open: new Set(),
  acted: {},
  resolve: () => {},
  toggleHistory: () => {},
});

function StatusCell({ data }: CustomCellRendererProps<GridRow>) {
  return data?.kind === "order" ? <StateBadge status={data.status} /> : null;
}

function ActionsCell({ data }: CustomCellRendererProps<GridRow>) {
  const { busyId, open, resolve, toggleHistory } = useContext(ControlsContext);
  if (data?.kind !== "order") return null;
  const expanded = open.has(data.id);
  const busy = busyId !== null;
  return (
    <div className="flex h-full flex-wrap items-center gap-2">
      {vendorActionsFor(data.status).map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => resolve(data.id, a.resolution)}
          disabled={busy}
          className={`${resolveBtn} ${
            a.id === "release"
              ? "bg-ink text-paper hover:bg-pp-600"
              : "border border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-500/40 dark:text-rose-300 dark:hover:bg-rose-500/10"
          }`}
        >
          {busyId === data.id ? "Resolving…" : a.label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => toggleHistory(data.id)}
        aria-expanded={expanded}
        aria-controls={`history-${data.id}`}
        className={`${resolveBtn} whitespace-nowrap border border-ink/25 text-ink hover:border-ink`}
      >
        {expanded ? "Hide history" : "History"}
      </button>
    </div>
  );
}

function DetailCell({ data }: CustomCellRendererProps<GridRow>) {
  const { acted } = useContext(ControlsContext);
  if (data?.kind !== "detail") return null;
  const o = data.order;
  return (
    <div id={`history-${o.id}`} className="h-full overflow-auto py-2 pl-4 pr-4">
      <div className="reveal max-w-2xl rounded-[3px] border border-rule bg-foreground/[0.025] p-4">
        <OrderTimeline
          orderId={o.id}
          refreshKey={`${o.status}:${o.updated_at}:${acted[o.id] ?? 0}`}
        />
      </div>
    </div>
  );
}

// Read a field off order rows only; detail rows are full-width and have none.
const orderField =
  <K extends keyof OrderRow>(key: K) =>
  (p: { data?: GridRow }) =>
    p.data?.kind === "order" ? p.data[key] : null;

const columns: ColDef<GridRow>[] = [
  {
    colId: "id",
    headerName: "Order",
    minWidth: 130,
    cellClass: "font-mono text-xs text-muted",
    valueGetter: orderField("id"),
  },
  {
    colId: "dataset",
    headerName: "Dataset",
    minWidth: 120,
    valueGetter: orderField("dataset_id"),
  },
  {
    colId: "buyer",
    headerName: "Buyer",
    minWidth: 150,
    cellClass: "text-muted",
    valueGetter: orderField("buyer_email"),
  },
  {
    colId: "amount",
    headerName: "Amount",
    minWidth: 90,
    cellClass: "tabular-nums",
    valueGetter: orderField("amount_cents"),
    valueFormatter: (p) => (typeof p.value === "number" ? usd(p.value) : ""),
  },
  {
    colId: "status",
    headerName: "State",
    minWidth: 130,
    valueGetter: orderField("status"),
    cellRenderer: StatusCell,
  },
  {
    colId: "updated",
    headerName: "Updated",
    minWidth: 160,
    cellClass: "text-xs text-muted",
    valueGetter: (p) =>
      p.data?.kind === "order"
        ? when(p.data.updated_at ?? p.data.created_at)
        : null,
  },
  {
    colId: "actions",
    headerName: "Actions",
    flex: 2,
    minWidth: 260,
    sortable: false,
    cellRenderer: ActionsCell,
  },
];

// Stable identity (see DataGrid): a new object per render resets column state.
const QUEUE_COL_DEF: ColDef<GridRow> = {
  flex: 1,
  minWidth: 100,
  sortable: false,
};

export default function IncomingOrders() {
  const gridRef = useRef<AgGridReact<GridRow>>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsOnly, setNeedsOnly] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Orders whose audit timeline is expanded, and a per-order counter bumped
  // after the vendor acts so an open timeline refetches immediately.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [acted, setActed] = useState<Record<string, number>>({});
  // The grid's external-filter callbacks read this, so they never go stale.
  const needsOnlyRef = useRef(false);

  const toggleHistory = useCallback((orderId: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  }, []);

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

  // Initial load + polling so the book reflects buyer-side escrow moves live.
  // The first fetch is deferred (setTimeout 0) rather than called inline, so it
  // runs as an async callback instead of a synchronous setState in the effect.
  useEffect(() => {
    const first = setTimeout(load, 0);
    const poll = setInterval(load, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
    };
  }, [load]);

  useEffect(() => {
    needsOnlyRef.current = needsOnly;
    gridRef.current?.api?.onFilterChanged();
  }, [needsOnly]);

  // Resolve a disputed order: capture = release the held funds to the vendor;
  // void = refund the buyer. On success we refetch so the row reflects the DB.
  const resolve = useCallback(
    async (orderId: string, resolution: "capture" | "void") => {
      setBusyId(orderId);
      setMessage(null);
      try {
        const res = await fetch("/api/orders", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "resolve", resolution, orderId }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          setMessage(
            resolution === "capture"
              ? `Dispute resolved — funds released to vendor (${data.escrowState ?? "CAPTURED"}).`
              : `Dispute resolved — buyer refunded (${data.escrowState ?? "VOIDED"}).`,
          );
          await load();
        } else {
          setMessage(data?.error ?? `Resolve failed (${res.status}).`);
        }
      } catch {
        setMessage("Could not reach the order service.");
      } finally {
        setBusyId(null);
        setActed((prev) => ({ ...prev, [orderId]: (prev[orderId] ?? 0) + 1 }));
      }
    },
    [load],
  );

  const controls = useMemo<Controls>(
    () => ({ busyId, open, acted, resolve, toggleHistory }),
    [busyId, open, acted, resolve, toggleHistory],
  );

  // Each order, followed by its history row while that is open.
  const rows = useMemo<GridRow[]>(
    () =>
      orders.flatMap<GridRow>((o) => [
        { ...o, kind: "order" },
        ...(open.has(o.id)
          ? [{ kind: "detail" as const, id: `${o.id}:detail`, order: o }]
          : []),
      ]),
    [orders, open],
  );

  const disputeCount = orders.filter((o) => o.status === "DISPUTED").length;
  const needsCount = orders.filter((o) => needsAction(o.status)).length;
  const visibleOrders = needsOnly ? needsCount : orders.length;
  const visibleDetails = orders.filter(
    (o) => open.has(o.id) && (!needsOnly || needsAction(o.status)),
  ).length;
  const gridHeight = Math.min(
    46 + visibleOrders * ROW_HEIGHT + visibleDetails * DETAIL_HEIGHT + 2,
    640,
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {loading
            ? "Loading orders…"
            : `${orders.length} order${orders.length === 1 ? "" : "s"}` +
              (disputeCount > 0 ? ` · ${disputeCount} disputed` : "")}
        </p>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={needsOnly}
            onChange={(e) => setNeedsOnly(e.target.checked)}
            className="h-4 w-4 accent-pp-600"
          />
          Needs action
        </label>
      </div>

      {error && (
        <div className="mb-4 rounded-[3px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          {error}
        </div>
      )}

      {message && <p className="mb-4 text-sm text-muted">{message}</p>}

      {!loading && visibleOrders === 0 ? (
        <p className="rounded-[3px] border border-dashed border-zinc-300 p-8 text-center text-sm text-muted dark:border-zinc-700">
          {needsOnly
            ? "Nothing needs your action."
            : "No orders yet. Orders appear here once a buyer authorizes escrow."}
        </p>
      ) : (
        <ControlsContext.Provider value={controls}>
          <DataGrid<GridRow>
            gridRef={gridRef}
            rowData={rows}
            columnDefs={columns}
            getRowId={(r) => r.id}
            height={gridHeight}
            options={{
              loading,
              // Rows stay in newest-first API order so a history row always
              // sits under its order; sorting would pull them apart.
              defaultColDef: QUEUE_COL_DEF,
              getRowHeight: (p) =>
                p.data?.kind === "detail" ? DETAIL_HEIGHT : ROW_HEIGHT,
              isFullWidthRow: (p) => p.rowNode.data?.kind === "detail",
              fullWidthCellRenderer: DetailCell,
              isExternalFilterPresent: () => needsOnlyRef.current,
              doesExternalFilterPass: (node) => {
                const d = node.data;
                if (!d) return true;
                const order = d.kind === "detail" ? d.order : d;
                return needsAction(order.status);
              },
            }}
          />
        </ControlsContext.Provider>
      )}
    </div>
  );
}
