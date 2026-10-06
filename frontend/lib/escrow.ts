import { Order, EscrowState } from "./types";

const TRANSITIONS: Record<EscrowState, Set<EscrowState>> = {
  PENDING_PAYMENT: new Set(["FUNDED", "CANCELLED"]),
  FUNDED: new Set(["RELEASED", "REFUNDED"]),
  RELEASED: new Set(),
  REFUNDED: new Set(),
  CANCELLED: new Set(),
};

export class EscrowError extends Error {}

// In-memory store. Survives across requests in dev via globalThis (Next hot-reload safe).
// Replace with DynamoDB for deploy — see backend/escrow.py DynamoStore.
const store: Map<string, Order> =
  (globalThis as any).__ESCROW_STORE__ ?? new Map<string, Order>();
(globalThis as any).__ESCROW_STORE__ = store;

export function putOrder(o: Order) {
  store.set(o.order_id, o);
}
export function getOrder(id: string): Order | undefined {
  return store.get(id);
}
export function findByPayPalOrder(ppId: string): Order | undefined {
  for (const o of store.values()) if (o.paypal_order_id === ppId) return o;
  return undefined;
}

function move(order: Order, next: EscrowState): Order {
  if (!TRANSITIONS[order.state].has(next)) {
    throw new EscrowError(`illegal transition ${order.state} -> ${next}`);
  }
  order.state = next;
  if (next === "FUNDED") order.funded_at = Math.floor(Date.now() / 1000);
  if (next === "RELEASED") order.released_at = Math.floor(Date.now() / 1000);
  putOrder(order);
  return order;
}

export function markFunded(ppId: string): Order {
  const order = findByPayPalOrder(ppId);
  if (!order) throw new EscrowError("order not found");
  if (order.state === "FUNDED") return order; // idempotent replay
  return move(order, "FUNDED");
}

export function confirmReceipt(orderId: string): Order {
  const order = getOrder(orderId);
  if (!order) throw new EscrowError("order not found");
  return move(order, "RELEASED");
}

export function downloadUrl(orderId: string): string {
  const order = getOrder(orderId);
  if (!order || order.state !== "FUNDED") {
    throw new EscrowError("data is only released after escrow is funded");
  }
  const ttl = process.env.PRESIGNED_URL_TTL_SECONDS || "900";
  // Stubbed presigned URL. Real S3 presign happens in the Python Lambda on deploy.
  return `https://mock-bucket.local/datasets/${order.listing_id}?expires=${ttl}`;
}
