"use client";

// Marketplace insights (client component). Reads GET /api/insights and shows a
// KPI strip, the orders-by-state mix, and two AG Grid tables (vendors and
// datasets) whose money columns carry inline bars drawn by cell renderers.
// Colour carries meaning: PayPal blue is money still held in escrow, emerald
// is money released to the vendor, everything else is ink.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ColDef } from "ag-grid-community";
import type { CustomCellRendererProps } from "ag-grid-react";
import type {
  DatasetInsight,
  Insights,
  VendorInsight,
} from "../../lib/insights/summary";
import DataGrid from "./DataGrid";
import { AlertTriangle } from "./icons";

const POLL_MS = 8000;

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(rate > 0 && rate < 0.1 ? 1 : 0)}%`;
}

function hours(h: number | null): string {
  if (h === null) return "n/a";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} d`;
}

const STATUS_LABEL: Record<string, string> = {
  MATCHED: "Matched",
  AUTHORIZED: "Authorized",
  DELIVERED: "Delivered",
  CAPTURED: "Captured",
  PAID_OUT: "Paid out",
  DISPUTED: "Disputed",
  VOIDED: "Voided",
  CANCELLED: "Cancelled",
};

// ---- Cell renderers (inline bars, no chart library) -----------------------

interface BarParams {
  max: number;
}

/** Vendor money: held (blue) then released (emerald), sized against the max. */
function VendorMoneyCell(
  props: CustomCellRendererProps<VendorInsight> & BarParams,
) {
  const d = props.data;
  if (!d) return null;
  const w = (c: number) => (props.max > 0 ? (c / props.max) * 100 : 0);
  return (
    <span className="flex h-full items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-[2px] bg-rule/60"
      >
        <span
          className="h-full bg-pp-500"
          style={{ width: `${w(d.heldCents)}%` }}
        />
        <span
          className="h-full bg-emerald-600"
          style={{ width: `${w(d.releasedCents)}%` }}
        />
      </span>
      <span className="w-20 shrink-0 text-right font-mono text-[0.8rem]">
        {usd(d.gmvCents)}
      </span>
    </span>
  );
}

/** Dataset GMV: a single ink bar with the amount beside it. */
function DatasetMoneyCell(
  props: CustomCellRendererProps<DatasetInsight> & BarParams,
) {
  const d = props.data;
  if (!d) return null;
  const width = props.max > 0 ? (d.gmvCents / props.max) * 100 : 0;
  return (
    <span className="flex h-full items-center gap-3">
      <span
        aria-hidden="true"
        className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-[2px] bg-rule/60"
      >
        <span className="h-full bg-ink" style={{ width: `${width}%` }} />
      </span>
      <span className="w-20 shrink-0 text-right font-mono text-[0.8rem]">
        {usd(d.gmvCents)}
      </span>
    </span>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "held" | "released";
}) {
  const color =
    tone === "held"
      ? "text-pp-600 dark:text-pp-400"
      : tone === "released"
        ? "text-emerald-700 dark:text-emerald-400"
        : "";
  return (
    <div className="border-t border-rule pt-4">
      <dt className="flex items-center gap-2 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
        {tone === "held" && (
          <span
            aria-hidden
            className="held-dot h-2 w-2 rounded-full bg-pp-500"
          />
        )}
        {label}
      </dt>
      <dd
        className={`mt-2 font-serif text-3xl font-light tabular-nums ${color}`}
      >
        {value}
      </dd>
      <dd className="mt-1 text-xs font-light text-muted">{hint}</dd>
    </div>
  );
}

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; insights: Insights };

export default function InsightsDashboard() {
  const [state, setState] = useState<Load>({ status: "loading" });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/insights", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.insights) {
        const message =
          data?.error ?? `Insights service responded ${res.status}.`;
        setState((prev) =>
          prev.status === "ready" ? prev : { status: "error", message },
        );
        return;
      }
      setState({ status: "ready", insights: data.insights });
    } catch {
      setState((prev) =>
        prev.status === "ready"
          ? prev
          : { status: "error", message: "Could not reach the server." },
      );
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

  const insights = state.status === "ready" ? state.insights : null;

  const vendorCols = useMemo<ColDef<VendorInsight>[]>(() => {
    const max = Math.max(
      0,
      ...(insights?.byVendor ?? []).map((v) => v.gmvCents),
    );
    return [
      { field: "name", headerName: "Vendor", flex: 2, minWidth: 160 },
      {
        field: "orders",
        headerName: "Orders",
        flex: 1,
        minWidth: 80,
        type: "numericColumn",
      },
      {
        field: "gmvCents",
        headerName: "Held and released",
        flex: 3,
        minWidth: 240,
        cellRenderer: VendorMoneyCell,
        cellRendererParams: { max },
      },
      {
        field: "feeCents",
        headerName: "Platform fee",
        flex: 1.2,
        minWidth: 110,
        type: "numericColumn",
        valueFormatter: (p) => usd(p.value ?? 0),
      },
      {
        field: "netCents",
        headerName: "Vendor net",
        flex: 1.2,
        minWidth: 110,
        type: "numericColumn",
        valueFormatter: (p) => usd(p.value ?? 0),
      },
      {
        field: "disputes",
        headerName: "Disputes",
        flex: 1,
        minWidth: 90,
        type: "numericColumn",
      },
    ];
  }, [insights]);

  const datasetCols = useMemo<ColDef<DatasetInsight>[]>(() => {
    const max = Math.max(
      0,
      ...(insights?.topDatasets ?? []).map((d) => d.gmvCents),
    );
    return [
      { field: "title", headerName: "Dataset", flex: 3, minWidth: 220 },
      { field: "vendorName", headerName: "Vendor", flex: 2, minWidth: 140 },
      {
        field: "orders",
        headerName: "Orders",
        flex: 1,
        minWidth: 80,
        type: "numericColumn",
      },
      {
        field: "gmvCents",
        headerName: "GMV",
        flex: 3,
        minWidth: 220,
        cellRenderer: DatasetMoneyCell,
        cellRendererParams: { max },
      },
      {
        field: "queries",
        headerName: "Queries",
        flex: 1,
        minWidth: 90,
        type: "numericColumn",
      },
    ];
  }, [insights]);

  if (state.status === "error") {
    return (
      <p
        className="inline-flex flex-wrap items-center gap-1.5 rounded-[3px] border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
        role="alert"
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Insights unavailable: {state.message}
        <button
          type="button"
          onClick={load}
          className="font-medium underline-offset-2 hover:underline"
        >
          Retry
        </button>
      </p>
    );
  }

  if (!insights) {
    return (
      <p className="text-sm text-muted" role="status">
        Loading insights...
      </p>
    );
  }

  if (insights.orderCount === 0) {
    return (
      <div className="border-t border-rule pt-8" role="status">
        <p className="font-serif text-2xl font-light">No orders yet.</p>
        <p className="mt-2 max-w-xl text-sm font-light text-muted">
          Insights are computed from real orders. Run the guided demo to place
          one through escrow, or start from a study description as a researcher.
        </p>
        <div className="mt-5 flex gap-3">
          <Link
            href="/demo"
            className="bg-ink px-4 py-2 text-sm text-paper transition-opacity hover:opacity-85"
          >
            Open the guided demo
          </Link>
          <Link
            href="/researcher"
            className="border border-rule px-4 py-2 text-sm transition-colors hover:border-ink"
          >
            Researcher workspace
          </Link>
        </div>
      </div>
    );
  }

  const mix = insights.byStatus.filter((r) => r.count > 0);

  return (
    <div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-4">
        <Kpi
          label="Held in escrow"
          value={usd(insights.heldCents)}
          hint="Authorized, delivered or disputed"
          tone="held"
        />
        <Kpi
          label="Released"
          value={usd(insights.releasedCents)}
          hint="Captured or paid out"
          tone="released"
        />
        <Kpi
          label="Platform fee earned"
          value={usd(insights.platformFeeCents)}
          hint="10% of released orders"
        />
        <Kpi
          label="Dispute rate"
          value={pct(insights.disputeRate)}
          hint="Disputed of all authorized orders"
        />
        <Kpi
          label="GMV"
          value={usd(insights.gmvCents)}
          hint="Held plus released"
        />
        <Kpi
          label="Avg time to deliver"
          value={hours(insights.avgTimeToDeliverHours)}
          hint="Authorization to delivery"
        />
        <Kpi
          label="Queries answered"
          value={String(insights.queryCount)}
          hint={`${usd(insights.queryRevenueCents)} metered`}
        />
        <Kpi
          label="Returned to buyers"
          value={usd(insights.refundedCents)}
          hint="Voided authorizations"
        />
      </dl>

      <div className="mt-6">
        <p className="mb-2 font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
          Orders by state
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Orders by state">
          {mix.map((r) => (
            <li
              key={r.status}
              className="inline-flex items-center gap-1.5 rounded-full border border-rule px-2.5 py-0.5 text-xs"
            >
              {STATUS_LABEL[r.status] ?? r.status}
              <span className="font-mono font-semibold">{r.count}</span>
              <span className="font-mono text-muted">{usd(r.amountCents)}</span>
            </li>
          ))}
        </ul>
      </div>

      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="mb-1 font-serif text-[1.6rem] font-normal">Vendors</h2>
        <p className="mb-4 flex flex-wrap items-center gap-x-4 text-sm font-light text-muted">
          <span>Money per vendor, sorted by GMV.</span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 bg-pp-500" /> held
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 bg-emerald-600" /> released
          </span>
        </p>
        <DataGrid<VendorInsight>
          rowData={insights.byVendor}
          columnDefs={vendorCols}
          getRowId={(v) => v.vendorId}
          height={Math.min(420, 46 * (insights.byVendor.length + 1) + 4)}
        />
      </section>

      <section className="mt-12 border-t border-rule pt-8 pb-10">
        <h2 className="mb-1 font-serif text-[1.6rem] font-normal">
          Top datasets
        </h2>
        <p className="mb-4 text-sm font-light text-muted">
          Ranked by GMV (held plus released). Voided and unpaid orders add
          nothing.
        </p>
        <DataGrid<DatasetInsight>
          rowData={insights.topDatasets}
          columnDefs={datasetCols}
          getRowId={(d) => d.datasetId}
          height={Math.min(520, 46 * (insights.topDatasets.length + 1) + 4)}
        />
      </section>
    </div>
  );
}
