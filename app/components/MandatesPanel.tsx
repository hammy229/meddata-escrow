"use client";

// Agent spending controls (client component). The buyer signs a spending mandate
// for the agent, watches what each one has spent in an AG Grid, and can revoke
// one at any time. The token only exists in this tab's memory, because the
// server never stores it: the newest one signed here is what the next agent run
// uses, and it can be copied into an MCP client.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import DataGrid from "./DataGrid";
import { AlertTriangle, Check } from "./icons";
import {
  mandateBody,
  spentPercent,
  type MandateRow,
} from "../../lib/ui/mandates";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function SpentCell({ data }: ICellRendererParams<MandateRow>) {
  if (!data) return null;
  const pct = spentPercent(data);
  return (
    <span className="flex h-full flex-col justify-center gap-1 leading-none">
      <span className="font-mono text-xs tabular-nums">
        {usd(data.spentCents)} of {usd(data.maxTotalCents)}
      </span>
      <span
        role="meter"
        aria-label="Budget spent"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="block h-1 w-full bg-rule"
      >
        <span
          className={`block h-full ${pct >= 100 ? "bg-amber-500" : "bg-pp-600"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  );
}

const STATUS_TONE: Record<MandateRow["status"], string> = {
  active: "text-pp-700 dark:text-pp-300",
  expired: "text-muted",
  revoked: "text-rose-700 dark:text-rose-300",
};

function StatusCell({ data }: ICellRendererParams<MandateRow>) {
  if (!data) return null;
  return (
    <span className={`text-sm capitalize ${STATUS_TONE[data.status]}`}>
      {data.status}
    </span>
  );
}

export default function MandatesPanel({
  inputBase,
  primaryBtn,
  refreshKey,
  onActiveToken,
}: {
  inputBase: string;
  primaryBtn: string;
  /** Bump after an agent run so spending updates. */
  refreshKey: number;
  /** The token the next agent run should use, or null for none. */
  onActiveToken: (token: string | null) => void;
}) {
  const [rows, setRows] = useState<MandateRow[]>([]);
  const [totalUsd, setTotalUsd] = useState("100");
  const [perOrderUsd, setPerOrderUsd] = useState("60");
  const [hours, setHours] = useState(24);
  const [active, setActive] = useState<{
    id: string;
    token: string;
    revoked?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mandates");
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data?.mandates)) {
        setError(data?.error ?? "Could not load your mandates.");
        return;
      }
      setRows(data.mandates as MandateRow[]);
    } catch {
      setError("Could not load your mandates.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and after each run
    void load();
  }, [load, refreshKey]);

  async function sign() {
    const parsed = mandateBody({ totalUsd, perOrderUsd, hours });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/mandates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || typeof data?.token !== "string") {
        setError(data?.error ?? "Could not sign the mandate.");
        return;
      }
      setActive({ id: data.mandate.id, token: data.token });
      onActiveToken(data.token);
      setCopied(false);
      await load();
    } catch {
      setError("Could not sign the mandate.");
    } finally {
      setBusy(false);
    }
  }

  const revoke = useCallback(
    async (id: string) => {
      setError(null);
      try {
        const res = await fetch(
          `/api/mandates?mandateId=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? "Could not revoke the mandate.");
          return;
        }
        // The agent keeps presenting the token, so the server refuses the next
        // run. Dropping it would quietly run the agent with no mandate at all.
        setActive((current) =>
          current?.id === id ? { ...current, revoked: true } : current,
        );
        await load();
      } catch {
        setError("Could not revoke the mandate.");
      }
    },
    [load],
  );

  async function copyToken() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.token);
      setCopied(true);
    } catch {
      setError("Your browser blocked the clipboard.");
    }
  }

  const activeId = active?.id;
  const columns = useMemo<ColDef<MandateRow>[]>(
    () => [
      {
        headerName: "Spent",
        flex: 2,
        minWidth: 170,
        sortable: false,
        cellRenderer: SpentCell,
      },
      {
        field: "remainingCents",
        headerName: "Left",
        minWidth: 90,
        flex: 1,
        type: "numericColumn",
        valueFormatter: (p) => usd(p.value ?? 0),
      },
      {
        field: "maxPerOrderCents",
        headerName: "Per order",
        minWidth: 100,
        flex: 1,
        type: "numericColumn",
        valueFormatter: (p) => usd(p.value ?? 0),
      },
      {
        field: "status",
        headerName: "Status",
        minWidth: 90,
        flex: 1,
        cellRenderer: StatusCell,
      },
      {
        field: "expiresAt",
        headerName: "Expires",
        minWidth: 150,
        flex: 1.4,
        valueFormatter: (p) =>
          p.value ? new Date(p.value as string).toLocaleString() : "",
      },
      {
        headerName: "",
        minWidth: 140,
        flex: 1.2,
        sortable: false,
        resizable: false,
        cellRenderer: (p: ICellRendererParams<MandateRow>) => {
          if (!p.data || p.data.status !== "active") return null;
          const id = p.data.id;
          return (
            <span className="flex h-full items-center gap-3">
              <button
                type="button"
                onClick={() => void revoke(id)}
                className="text-sm text-rose-700 underline underline-offset-4 dark:text-rose-300"
              >
                Revoke
              </button>
              {id === activeId && (
                <span className="text-xs text-muted">In use</span>
              )}
            </span>
          );
        },
      },
    ],
    [activeId, revoke],
  );

  return (
    <div>
      <h3 className="text-sm font-medium">Spending mandate</h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Sign a limit for the agent. The server refuses any order outside it, and
        revoking it stops the agent right away.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="text-muted">Total budget (USD)</span>
          <input
            type="number"
            min="1"
            inputMode="decimal"
            value={totalUsd}
            onChange={(e) => setTotalUsd(e.target.value)}
            className={`mt-1 block w-32 font-mono tabular-nums ${inputBase}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Per-order cap (USD)</span>
          <input
            type="number"
            min="1"
            inputMode="decimal"
            value={perOrderUsd}
            onChange={(e) => setPerOrderUsd(e.target.value)}
            className={`mt-1 block w-32 font-mono tabular-nums ${inputBase}`}
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Valid for</span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className={`mt-1 block w-32 ${inputBase}`}
          >
            <option value={1}>1 hour</option>
            <option value={24}>1 day</option>
            <option value={168}>7 days</option>
          </select>
        </label>
        <button onClick={sign} disabled={busy} className={primaryBtn}>
          {busy ? "Signing…" : "Sign mandate"}
        </button>
        {active && !active.revoked && (
          <button
            type="button"
            onClick={copyToken}
            className="py-2.5 text-sm text-pp-700 underline underline-offset-4 dark:text-pp-400"
          >
            {copied ? "Copied" : "Copy token for an MCP client"}
          </button>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="h-4 w-4" />
          {error}
        </p>
      )}

      {active?.revoked && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-4 w-4" />
          Revoked. The agent is blocked until you sign a new mandate.
        </p>
      )}
      {active && !active.revoked && (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm text-pp-700 dark:text-pp-300">
          <Check className="h-4 w-4" />
          The agent will run under this mandate.
        </p>
      )}

      {rows.length > 0 && (
        <div className="mt-4">
          <DataGrid<MandateRow>
            rowData={rows}
            columnDefs={columns}
            getRowId={(r) => r.id}
            height={Math.min(280, 58 + rows.length * 46)}
          />
        </div>
      )}
    </div>
  );
}
