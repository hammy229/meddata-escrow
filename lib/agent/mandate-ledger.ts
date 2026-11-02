// Per-mandate spend ledger. In memory and per process, like lib/http/rate-limit:
// it survives across agent runs and MCP calls within one server instance and
// resets on restart. A durable ledger would need a DB table; for the mock-first
// demo the mandate token itself (not this map) is the source of authority.
//
// Spend is committed when an escrow order is OPENED (MATCHED), not when the
// buyer later approves it, so an agent cannot open unbounded pending orders.
const spent = new Map<string, number>();

export function spentUnderMandate(mandateId: string): number {
  return spent.get(mandateId) ?? 0;
}

export function recordMandateSpend(mandateId: string, cents: number): number {
  const total = spentUnderMandate(mandateId) + cents;
  spent.set(mandateId, total);
  return total;
}

/** Test helper. */
export function resetMandateLedger(): void {
  spent.clear();
}
