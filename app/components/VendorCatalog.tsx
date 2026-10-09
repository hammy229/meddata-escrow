"use client";

// Client grid for the vendor catalog. Columns (with value formatters) live
// here on the client side; the server page passes only plain, serializable
// rows across the boundary.
import type { ColDef } from "ag-grid-community";
import DataGrid from "./DataGrid";

export interface CatalogRow {
  id: string;
  title: string;
  tags: string[];
  priceCents: number;
  recordCount: number;
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
    field: "priceCents",
    headerName: "Price",
    maxWidth: 120,
    valueFormatter: (p) =>
      typeof p.value === "number" ? `$${(p.value / 100).toFixed(2)}` : "",
  },
];

export default function VendorCatalog({ rows }: { rows: CatalogRow[] }) {
  return (
    <DataGrid<CatalogRow>
      rowData={rows}
      columnDefs={columns}
      getRowId={(r) => r.id}
      height={Math.min(80 + rows.length * 44, 480)}
    />
  );
}
