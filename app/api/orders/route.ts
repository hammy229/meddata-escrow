// /api/orders — escrow lifecycle via PayPal authorize-then-capture.
//
//   POST  { datasetId, amount, currency?, referenceId? }
//         -> create an Orders v2 order (intent=AUTHORIZE). Returns the approve
//            URL; escrow starts at MATCHED (funds not yet authorized).
//   PATCH { action: "authorize"|"capture"|"void", state?, orderId?,
//           authorizationId?, requestId? }
//         -> advance the escrow. The state-machine transition is validated
//            BEFORE any PayPal call, so an illegal move never charges anyone.
//
// Stateless for now (no DB): the caller passes the current `state`. Secrets
// come only from env via payPalClientFromEnv; errors never leak internals.
import {
  payPalClientFromEnv,
  PayPalError,
} from "../../../lib/paypal/client";
import {
  transition,
  InvalidTransitionError,
  type EscrowState,
  type EscrowEvent,
} from "../../../lib/escrow/state-machine";

const ACTION_EVENT: Record<string, EscrowEvent> = {
  authorize: "AUTHORIZE",
  capture: "CAPTURE",
  void: "VOID",
};

// Default "from" state per action when the caller omits it (no DB yet).
const DEFAULT_FROM: Record<EscrowEvent, EscrowState> = {
  AUTHORIZE: "MATCHED",
  CAPTURE: "DELIVERED",
  VOID: "AUTHORIZED",
} as Record<EscrowEvent, EscrowState>;

function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

function errorResponse(err: unknown): Response {
  if (err instanceof PayPalError) {
    return Response.json({ error: "PayPal request failed" }, { status: err.status });
  }
  if (err instanceof Error && err.message.includes("must be set")) {
    return Response.json({ error: "PayPal not configured (see .env.example)" }, { status: 503 });
  }
  // Unexpected: log server-side, return a generic error (no internals leaked).
  console.error("orders route error:", err);
  return Response.json({ error: "internal error" }, { status: 500 });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const datasetId = body?.datasetId;
  const amount = body?.amount;
  if (typeof datasetId !== "string" || typeof amount !== "number" || !(amount > 0)) {
    return bad("datasetId (string) and amount (positive number) are required");
  }
  try {
    const pp = payPalClientFromEnv();
    const order = await pp.createAuthorizeOrder({
      amount,
      currency: typeof body?.currency === "string" ? body.currency : undefined,
      referenceId: typeof body?.referenceId === "string" ? body.referenceId : undefined,
    });
    return Response.json(
      { orderId: order.orderId, status: order.status, approveUrl: order.approveUrl, escrowState: "MATCHED" },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const event = typeof action === "string" ? ACTION_EVENT[action] : undefined;
  if (!event) return bad(`action must be one of: ${Object.keys(ACTION_EVENT).join(", ")}`);

  // Required ids per action (checked before PayPal so bad input is a clean 422).
  if (event === "AUTHORIZE" && typeof body?.orderId !== "string") return bad("orderId is required");
  if ((event === "CAPTURE" || event === "VOID") && typeof body?.authorizationId !== "string") {
    return bad("authorizationId is required");
  }

  const from: EscrowState = typeof body?.state === "string" ? body.state : DEFAULT_FROM[event];
  let nextState: EscrowState;
  try {
    nextState = transition(from, event); // validated before any money moves
  } catch (err) {
    if (err instanceof InvalidTransitionError) return Response.json({ error: err.message }, { status: 409 });
    return errorResponse(err);
  }

  try {
    const pp = payPalClientFromEnv();
    if (event === "AUTHORIZE") {
      const auth = await pp.authorizeOrder(body.orderId);
      return Response.json({ escrowState: nextState, authorizationId: auth.authorizationId, status: auth.status });
    }
    if (event === "CAPTURE") {
      const cap = await pp.captureAuthorization(body.authorizationId, {
        requestId: typeof body?.requestId === "string" ? body.requestId : undefined,
      });
      return Response.json({ escrowState: nextState, captureId: cap.captureId, status: cap.status });
    }
    await pp.voidAuthorization(body.authorizationId);
    return Response.json({ escrowState: nextState });
  } catch (err) {
    return errorResponse(err);
  }
}
