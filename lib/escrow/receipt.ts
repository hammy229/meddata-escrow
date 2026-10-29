// Order receipt: what the buyer paid and how it splits between vendor and
// platform. Pure — callers load the order row and its usage rows.
//
// amountCents is the escrowed price; platformFeeCents + vendorPayoutCents
// always equal it (see ./fees). Per-query charges are metered on top.
// A VOIDED or CANCELLED order never charged the buyer, so every money field is
// 0 (queryCount still counts the queries that were run).
import type { OrderRow } from "../db/client";
import type { UsageRow } from "../db/usage";
import { platformFeeCents, vendorPayoutCents } from "./fees";

export interface Receipt {
  orderId: string;
  datasetId: string;
  status: OrderRow["status"];
  /** The escrowed price (captured amount once captured). */
  amountCents: number;
  platformFeeCents: number;
  vendorPayoutCents: number;
  queryCount: number;
  /** Sum of the per-query charges recorded for the order. */
  queryChargesCents: number;
  /** amountCents + queryChargesCents. */
  totalCents: number;
}

export function buildReceipt(
  order: Pick<OrderRow, "id" | "dataset_id" | "status" | "amount_cents">,
  usage: Pick<UsageRow, "charge_cents">[],
): Receipt {
  const uncharged = order.status === "VOIDED" || order.status === "CANCELLED";
  const amountCents = uncharged ? 0 : order.amount_cents;
  const queryChargesCents = uncharged
    ? 0
    : usage.reduce((sum, u) => sum + u.charge_cents, 0);
  return {
    orderId: order.id,
    datasetId: order.dataset_id,
    status: order.status,
    amountCents,
    platformFeeCents: platformFeeCents(amountCents),
    vendorPayoutCents: vendorPayoutCents(amountCents),
    queryCount: usage.length,
    queryChargesCents,
    totalCents: amountCents + queryChargesCents,
  };
}
