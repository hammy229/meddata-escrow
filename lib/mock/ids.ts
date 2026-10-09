// Deterministic-shape mock identifiers for creds-free MOCK MODE (local demo).
// No network, no PayPal: just a prefixed short UUID so responses look real.

/** `${prefix}-<short-uuid>`, e.g. mockId("MOCK-ORDER") -> "MOCK-ORDER-a1b2c3d4". */
export function mockId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

/** True when the route should bypass PayPal entirely (opt-in via env). */
export function isMockMode(): boolean {
  return process.env.PAYPAL_MODE === "mock";
}
