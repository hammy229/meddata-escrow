"use client";

// Vendor catalog (client component): the listing stats and an AG Grid of the
// datasets from GET /api/datasets. The Price cell is editable — dollars shown
// and typed, cents sent via PATCH /api/datasets. The cell updates at once; if
// the API refuses the price (4xx) it rolls back and the error is shown above
// the grid.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CellValueChangedEvent, ColDef } from "ag-grid-community";
import { dollarsToCents } from "../../lib/catalog/price-rules";
import DataGrid from "./DataGrid";

// Mirrors lib/db/datasets Dataset (GET /api/datasets). Kept local so this
// client component never imports the server-only db module.
export interface CatalogRow {
  id: string;
  title: string;
  tags: string[];
  priceCents: number;
  recordCount: number | null;
}

const columns: ColDef<CatalogRow>[] = [
  { field: "title", headerName: "Dataset", flex: 2, minWidth: 220 },
  {
    field: "tags",
    headerName: "Tags",
    flex: 2,
    minWidth: 180,
    valueFormatter: (p) => (Array.isArray(p.value) ? p.value.join(", ") : ""),
  },
  {
    field: "recordCount",
    headerName: "Records",
    maxWidth: 140,
    valueFormatter: (p) =>
      typeof p.value === "number" ? p.value.toLocaleString() : "",
  },
  {
    colId: "price",
    headerName: "Price (click to edit)",
    maxWidth: 170,
    editable: true,
    cellEditor: "agNumberCellEditor",
    cellEditorParams: { precision: 2, step: 0.01 },
    cellClass: "font-mono tabular-nums",
    // The grid works in dollars; the row keeps the cents the API speaks.
    valueGetter: (p) =>
      typeof p.data?.priceCents === "number" ? p.data.priceCents / 100 : null,
    valueSetter: (p) => {
      if (!p.data || typeof p.newValue !== "number") return false;
      p.data.priceCents = dollarsToCents(p.newValue);
      return true;
    },
    valueFormatter: (p) =>
      typeof p.value === "number" ? `$${p.value.toFixed(2)}` : "",
  },
];

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: CatalogRow[] };

const statLabel =
  "font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase";

export default function VendorCatalog() {
  const [state, setState] = useState<Load>({ status: "loading" });
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/datasets", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState({
          status: "error",
          message: data?.error ?? `Catalog service responded ${res.status}.`,
        });
        return;
      }
      setState({
        status: "ready",
        rows: Array.isArray(data.datasets) ? data.datasets : [],
      });
    } catch {
      setState({ status: "error", message: "Could not reach the catalog." });
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 0);
    return () => clearTimeout(first);
  }, [load]);

  const rows = useMemo(
    () => (state.status === "ready" ? state.rows : []),
    [state],
  );

  async function onPriceChanged(e: CellValueChangedEvent<CatalogRow>) {
    if (e.colDef.colId !== "price" || e.source === "rollback" || !e.data) {
      return;
    }
    const { id, title, priceCents } = e.data;
    const previous = e.oldValue;
    try {
      const res = await fetch("/api/datasets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ datasetId: id, priceCents }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        rollback(e, previous);
        setEditError(
          `${title}: ${body?.error ?? `price change refused (${res.status})`}`,
        );
        return;
      }
      setEditError(null);
      // Take the server's stored price as the truth.
      const saved = body?.dataset?.priceCents;
      if (typeof saved === "number") e.data.priceCents = saved;
      setState((s) =>
        s.status === "ready"
          ? {
              status: "ready",
              rows: s.rows.map((r) =>
                r.id === id ? { ...r, priceCents: e.data!.priceCents } : r,
              ),
            }
          : s,
      );
    } catch {
      rollback(e, previous);
      setEditError(`${title}: could not reach the catalog.`);
    }
  }

  const totalRecords = rows.reduce((sum, r) => sum + (r.recordCount ?? 0), 0);
  const avgPriceCents = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.priceCents, 0) / rows.length)
    : 0;

  return (
    <>
      <div className="grid grid-cols-2 border-t border-rule pb-6 sm:grid-cols-3">
        <div className="py-5 pr-6 not-first:border-l not-first:border-rule not-first:pl-6">
          <p className={statLabel}>Listings</p>
          <p className="mt-2 font-serif text-4xl font-light tabular-nums">
            {rows.length}
          </p>
        </div>
        <div className="py-5 pr-6 not-first:border-l not-first:border-rule not-first:pl-6">
          <p className={statLabel}>Total records</p>
          <p className="mt-2 font-serif text-4xl font-light tabular-nums">
            {totalRecords.toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 border-t border-rule py-5 sm:col-span-1 sm:border-t-0 sm:border-l sm:pl-6">
          <p className={statLabel}>Average price</p>
          <p className="mt-2 font-serif text-4xl font-light tabular-nums text-pp-600 dark:text-pp-400">
            ${(avgPriceCents / 100).toFixed(2)}
          </p>
        </div>
      </div>

      <section className="border-t border-rule pt-8 pb-10">
        <h2 className="mb-1 font-serif text-[1.6rem] font-normal">Catalog</h2>
        <p className="mb-6 text-sm font-light text-muted">
          Click a price to change it. New orders charge the price shown here.
        </p>
        {state.status === "error" && (
          <p
            role="alert"
            className="mb-3 rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {state.message}
          </p>
        )}
        {editError && (
          <p
            role="alert"
            className="mb-3 rounded-[3px] border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
          >
            {editError}
          </p>
        )}
        <DataGrid<CatalogRow>
          rowData={rows}
          columnDefs={columns}
          getRowId={(r) => r.id}
          height={Math.min(80 + Math.max(rows.length, 1) * 44, 480)}
          options={{
            loading: state.status === "loading",
            onCellValueChanged: onPriceChanged,
          }}
        />
      </section>
    </>
  );
}

// Put the old dollar value back in the cell. The "rollback" source stops the
// resulting change event from being sent to the API again.
function rollback(e: CellValueChangedEvent<CatalogRow>, previous: unknown) {
  if (typeof previous === "number") {
    e.node.setDataValue("price", previous, "rollback");
  }
}
