// PayPal client (Orders v2 / Payments API, sandbox).
// Wraps the authorize-then-capture escrow flow and per-query billing.
// Reads credentials from env (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET /
// PAYPAL_API_BASE). Placeholder — no logic yet.

export interface AuthorizeResult {
  orderId: string;
  authorizationId: string;
}

// Create an order and authorize funds (held in escrow, not captured).
export async function authorizeOrder(
  _amount: number,
  _currency = "USD",
): Promise<AuthorizeResult> {
  throw new Error("authorizeOrder not implemented");
}

// Capture a prior authorization once the sample check passes.
export async function captureAuthorization(
  _authorizationId: string,
): Promise<void> {
  throw new Error("captureAuthorization not implemented");
}

// Void a prior authorization if the sample check fails.
export async function voidAuthorization(
  _authorizationId: string,
): Promise<void> {
  throw new Error("voidAuthorization not implemented");
}

// Charge the researcher for a single metered query.
export async function chargePerQuery(
  _amount: number,
  _currency = "USD",
): Promise<void> {
  throw new Error("chargePerQuery not implemented");
}
