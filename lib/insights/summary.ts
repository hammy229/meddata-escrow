// Marketplace insights: a pure aggregation over orders, events and query
// usage, plus a thin loader that reads those rows from the database.
//
// Money buckets follow the escrow states:
//   held      AUTHORIZED + DELIVERED + DISPUTED (still in PayPal escrow)
//   released  CAPTURED + PAID_OUT              (the sale went through)
//   refunded  VOIDED                           (buyer was never charged)
// MATCHED and CANCELLED orders carry no money. GMV is held + released. The
// platform fee is earned only on released orders (lib/escrow/fees policy).
import type { DatabaseSync } from "node:sqlite";

import { platformFeeCents, vendorPayoutCents } from "../escrow/fees";
import { ESCROW_STATES, type EscrowState } from "../escrow/state-machine";

export interface InsightOrder {
  id: string;
  dataset_id: string;
  status: string;
  amount_cents: number;
  refunded_cents?: number;
}
export interface InsightDataset {
  id: string;
  vendor_id: string;
  title: string;
}
export interface InsightVendor {
  id: string;
  name: string;
}
export interface InsightEvent {
  order_id: string;
  event: string;
  created_at: string;
}
export interface InsightUsage {
  order_id: string;
  charge_cents: number;
}

export interface InsightsInput {
  orders: InsightOrder[];
  datasets: InsightDataset[];
  vendors: InsightVendor[];
  events: InsightEvent[];
  usage: InsightUsage[];
}

export interface StatusRow {
  status: EscrowState;
  count: number;
  amountCents: number;
}

export interface DatasetInsight {
  datasetId: string;
  title: string;
  vendorName: string;
  orders: number;
  gmvCents: number;
  queries: number;
  queryCents: number;
}

export interface VendorInsight {
  vendorId: string;
  name: string;
  orders: number;
  gmvCents: number;
  heldCents: number;
  releasedCents: number;
  feeCents: number;
  netCents: number;
  disputes: number;
}

export interface Insights {
  orderCount: number;
  gmvCents: number;
  heldCents: number;
  releasedCents: number;
  refundedCents: number;
  platformFeeCents: number;
  /** Orders that were ever disputed / orders that were ever authorized. */
  disputeRate: number;
  /** Mean AUTHORIZE to DELIVER gap in hours; null when nothing was delivered. */
  avgTimeToDeliverHours: number | null;
  queryCount: number;
  queryRevenueCents: number;
  byStatus: StatusRow[];
  topDatasets: DatasetInsight[];
  byVendor: VendorInsight[];
}

const HELD: ReadonlySet<string> = new Set([
  "AUTHORIZED",
  "DELIVERED",
  "DISPUTED",
]);
const RELEASED: ReadonlySet<string> = new Set(["CAPTURED", "PAID_OUT"]);

const HOUR_MS = 3_600_000;

/** SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) to epoch ms. */
function parseStamp(s: string): number {
  return Date.parse(s.replace(" ", "T") + "Z");
}

export function summarizeInsights(
  input: InsightsInput,
  opts: { topN?: number } = {},
): Insights {
  const topN = opts.topN ?? 10;
  const datasets = new Map(input.datasets.map((d) => [d.id, d]));
  const vendors = new Map(input.vendors.map((v) => [v.id, v]));

  // Per-order event facts.
  const authorizedAt = new Map<string, number>();
  const deliveredAt = new Map<string, number>();
  const disputed = new Set<string>();
  for (const e of input.events) {
    const t = parseStamp(e.created_at);
    if (e.event === "AUTHORIZE" && !authorizedAt.has(e.order_id))
      authorizedAt.set(e.order_id, t);
    else if (e.event === "DELIVER" && !deliveredAt.has(e.order_id))
      deliveredAt.set(e.order_id, t);
    else if (e.event === "DISPUTE") disputed.add(e.order_id);
  }

  const usageByOrder = new Map<string, { n: number; cents: number }>();
  let queryCount = 0;
  let queryRevenueCents = 0;
  for (const u of input.usage) {
    const cur = usageByOrder.get(u.order_id) ?? { n: 0, cents: 0 };
    cur.n += 1;
    cur.cents += u.charge_cents;
    usageByOrder.set(u.order_id, cur);
    queryCount += 1;
    queryRevenueCents += u.charge_cents;
  }

  const byStatus: StatusRow[] = ESCROW_STATES.map((status) => ({
    status,
    count: 0,
    amountCents: 0,
  }));
  const statusIdx = new Map(byStatus.map((r) => [r.status as string, r]));

  let heldCents = 0;
  let releasedCents = 0;
  let refundedCents = 0;
  let feeTotal = 0;

  const dsAgg = new Map<string, DatasetInsight>();
  const vAgg = new Map<string, VendorInsight>();

  for (const o of input.orders) {
    const row = statusIdx.get(o.status);
    if (row) {
      row.count += 1;
      row.amountCents += o.amount_cents;
    }

    const held = HELD.has(o.status);
    const released = RELEASED.has(o.status);
    if (held) heldCents += o.amount_cents;
    if (released) {
      releasedCents += o.amount_cents;
      feeTotal += platformFeeCents(o.amount_cents);
    }
    if (o.status === "VOIDED") refundedCents += o.amount_cents;
    refundedCents += o.refunded_cents ?? 0;

    const ds = datasets.get(o.dataset_id);
    const vendorId = ds?.vendor_id ?? "";
    const vendor = vendors.get(vendorId);
    const gmv = held || released ? o.amount_cents : 0;
    const wasDisputed = disputed.has(o.id) || o.status === "DISPUTED";
    const usage = usageByOrder.get(o.id);

    const d = dsAgg.get(o.dataset_id) ?? {
      datasetId: o.dataset_id,
      title: ds?.title ?? o.dataset_id,
      vendorName: vendor?.name ?? "Unknown vendor",
      orders: 0,
      gmvCents: 0,
      queries: 0,
      queryCents: 0,
    };
    d.orders += 1;
    d.gmvCents += gmv;
    d.queries += usage?.n ?? 0;
    d.queryCents += usage?.cents ?? 0;
    dsAgg.set(o.dataset_id, d);

    const v = vAgg.get(vendorId) ?? {
      vendorId,
      name: vendor?.name ?? "Unknown vendor",
      orders: 0,
      gmvCents: 0,
      heldCents: 0,
      releasedCents: 0,
      feeCents: 0,
      netCents: 0,
      disputes: 0,
    };
    v.orders += 1;
    v.gmvCents += gmv;
    if (held) v.heldCents += o.amount_cents;
    if (released) {
      v.releasedCents += o.amount_cents;
      v.feeCents += platformFeeCents(o.amount_cents);
      v.netCents += vendorPayoutCents(o.amount_cents);
    }
    if (wasDisputed) v.disputes += 1;
    vAgg.set(vendorId, v);
  }

  // Dispute rate.
  const orderIds = new Set(input.orders.map((o) => o.id));
  let authorizedCount = 0;
  let disputedCount = 0;
  for (const o of input.orders) {
    const everAuthorized =
      authorizedAt.has(o.id) ||
      (o.status !== "MATCHED" && o.status !== "CANCELLED");
    if (everAuthorized) {
      authorizedCount += 1;
      if (disputed.has(o.id) || o.status === "DISPUTED") disputedCount += 1;
    }
  }

  // Time to deliver.
  const gaps: number[] = [];
  for (const [id, start] of authorizedAt) {
    const end = deliveredAt.get(id);
    if (end === undefined || !orderIds.has(id)) continue;
    if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
    gaps.push((end - start) / HOUR_MS);
  }

  const byGmv = <T extends { gmvCents: number; orders: number }>(a: T, b: T) =>
    b.gmvCents - a.gmvCents || b.orders - a.orders;

  return {
    orderCount: input.orders.length,
    gmvCents: heldCents + releasedCents,
    heldCents,
    releasedCents,
    refundedCents,
    platformFeeCents: feeTotal,
    disputeRate: authorizedCount === 0 ? 0 : disputedCount / authorizedCount,
    avgTimeToDeliverHours: gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : null,
    queryCount,
    queryRevenueCents,
    byStatus,
    topDatasets: [...dsAgg.values()].sort(byGmv).slice(0, Math.max(0, topN)),
    byVendor: [...vAgg.values()].sort(byGmv),
  };
}

/** Read every row the aggregation needs and summarize it. */
export function loadInsights(
  db: DatabaseSync,
  opts: { topN?: number } = {},
): Insights {
  const all = <T>(sql: string) => db.prepare(sql).all() as unknown as T[];
  return summarizeInsights(
    {
      orders: all<InsightOrder>(
        `SELECT id, dataset_id, status, amount_cents, refunded_cents FROM orders`,
      ),
      datasets: all<InsightDataset>(
        `SELECT id, vendor_id, title FROM datasets`,
      ),
      vendors: all<InsightVendor>(`SELECT id, name FROM vendors`),
      events: all<InsightEvent>(
        `SELECT order_id, event, created_at FROM order_events`,
      ),
      usage: all<InsightUsage>(
        `SELECT order_id, charge_cents FROM query_usage`,
      ),
    },
    opts,
  );
}

/** Async application loader; scope private financial figures to the account. */
export async function loadAppInsights(
  db: import("../db/connection").AppDatabase,
  account?: import("../auth/store").Account,
): Promise<Insights> {
  const all = async <T>(sql: string) => (await db.prepare(sql).all()) as T[];
  let orders = await all<InsightOrder & { account_id?: string | null }>(
    "SELECT id, dataset_id, status, amount_cents, refunded_cents, account_id FROM orders",
  );
  let datasets = await all<InsightDataset>(
    "SELECT id, vendor_id, title FROM datasets",
  );
  let vendors = await all<InsightVendor>("SELECT id, name FROM vendors");
  if (account) {
    if (account.role === "vendor")
      datasets = datasets.filter((d) => d.vendor_id === account.vendor_id);
    const datasetIds = new Set(datasets.map((d) => d.id));
    orders = orders.filter((o) =>
      account.role === "researcher"
        ? o.account_id === account.id
        : datasetIds.has(o.dataset_id),
    );
    const purchased = new Set(orders.map((o) => o.dataset_id));
    if (account.role === "researcher")
      datasets = datasets.filter((d) => purchased.has(d.id));
    const vendorIds = new Set(datasets.map((d) => d.vendor_id));
    vendors = vendors.filter((v) => vendorIds.has(v.id));
  }
  const orderIds = new Set(orders.map((o) => o.id));
  const events = (
    await all<InsightEvent>(
      "SELECT order_id, event, created_at FROM order_events",
    )
  ).filter((e) => orderIds.has(e.order_id));
  const usage = (
    await all<InsightUsage>("SELECT order_id, charge_cents FROM query_usage")
  ).filter((u) => orderIds.has(u.order_id));
  return summarizeInsights({ orders, datasets, vendors, events, usage });
}
