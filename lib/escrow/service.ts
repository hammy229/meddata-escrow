// Escrow service: the framework-free business logic behind /api/orders.
//
// Two operations, reusable by the HTTP route and by an AI procurement agent:
//
//   createEscrowOrder  -> PayPal Orders v2 order (intent=AUTHORIZE) + an
//                         `orders` row in MATCHED. The escrowed amount is
//                         ALWAYS the dataset's listed price; a caller `amount`
//                         is only a confirmation (mismatch = 422).
//   advanceEscrowOrder -> apply an action (authorize | deliver | capture |
//                         payout | void | dispute | resolve) to a stored order.
//                         The stored row is the source of truth for the `from`
//                         state and PayPal ids. The state-machine transition is
//                         validated BEFORE any PayPal call, so an illegal move
//                         never charges anyone and never writes.
//
// Failures are thrown as EscrowError with an HTTP-ish `status` and a stable
// `code`, so callers can map them without parsing messages. Anything else that
// escapes (e.g. the DB is unreachable) is unexpected.
//
// MOCK MODE (PAYPAL_MODE=mock): no PayPal client, no network, mock ids — but
// rows are still persisted, so the demo has real, queryable orders.
import {
  payPalClientFromEnv,
  PayPalError,
  type PayPalClient,
} from "../paypal/client";
import {
  transition,
  InvalidTransitionError,
  type EscrowEvent,
  type EscrowState,
} from "./state-machine";
import {
  withDb,
  createOrder,
  getOrder,
  getDataset,
  advanceOrder,
  type OrderRow,
  type OrderPatch,
} from "../db/client";
import { mockId, isMockMode } from "../mock/ids";
import { randomUUID } from "node:crypto";

/** Buyer identity when the caller omits it (local demo — no auth layer yet). */
export const DEFAULT_BUYER_EMAIL = "demo-buyer@meddata.test";

/** Caller-facing actions and the state-machine event each one maps to. */
const ACTION_EVENT = {
  authorize: "AUTHORIZE",
  deliver: "DELIVER",
  capture: "CAPTURE",
  payout: "PAYOUT",
  void: "VOID",
  dispute: "DISPUTE",
} as const satisfies Record<string, EscrowEvent>;

export type EscrowAction = keyof typeof ACTION_EVENT | "resolve";
export type EscrowResolution = "capture" | "void";

/** Every action `advanceEscrowOrder` accepts (for tool schemas / validation). */
export const ESCROW_ACTIONS: readonly EscrowAction[] = [
  ...(Object.keys(ACTION_EVENT) as (keyof typeof ACTION_EVENT)[]),
  "resolve",
];

export type EscrowErrorCode =
  | "VALIDATION" // bad input (422)
  | "NOT_FOUND" // unknown order (404)
  | "INVALID_TRANSITION" // illegal state-machine move (409)
  | "PRECONDITION" // order lacks a PayPal id the action needs (409)
  | "PAYPAL" // PayPal returned non-2xx (PayPal's status)
  | "NOT_CONFIGURED" // PayPal credentials missing (503)
  | "NOT_IMPLEMENTED"; // seam not built yet (501)

/** A typed, expected failure. `status` is an HTTP-ish code; `message` is safe
 *  to show a caller (never credentials or PayPal internals). */
export class EscrowError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: EscrowErrorCode,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "EscrowError";
  }
}

/** Injectable dependencies (tests / alternative wiring). */
export interface EscrowDeps {
  /** Factory for the real PayPal client; defaults to payPalClientFromEnv. */
  paypal?: () => PayPalClient;
}

export interface CreateEscrowOrderInput {
  datasetId: string;
  /** Defaults to DEFAULT_BUYER_EMAIL. */
  buyerEmail?: string;
  /** Optional confirmation of the listed price, in major units (e.g. 49.00). */
  amount?: number;
  currency?: string;
  referenceId?: string;
}

export interface CreateEscrowOrderResult {
  /** Our DB order id (`ord_...`). */
  orderId: string;
  paypalOrderId: string;
  /** PayPal's order status (e.g. CREATED). */
  status: string;
  approveUrl?: string;
  escrowState: EscrowState;
  mock?: true;
}

export interface AdvanceEscrowOrderInput {
  orderId: string;
  action: EscrowAction;
  /** Required when action is "resolve". */
  resolution?: EscrowResolution;
  /** Free-text context recorded on the audit event (trimmed, max 500 chars). */
  note?: string;
  /** PayPal idempotency key for the money move (PayPal-Request-Id). */
  requestId?: string;
}

export interface AdvanceEscrowOrderResult {
  /** The persisted row after the transition. */
  order: OrderRow;
  escrowState: EscrowState;
  authorizationId?: string;
  captureId?: string;
  payoutBatchId?: string;
  /** PayPal's status for the money move, when there was one. */
  status?: string;
  mock?: true;
}

const MAX_NOTE = 500;

/**
 * Deterministic PayPal-Request-Id for a money move on one of our orders, e.g.
 * `ord_…:capture`. Keyed by the PayPal operation (not the caller's action), so
 * a capture and a dispute-resolve capture of the same order share one key: a
 * retry of either can never charge the buyer twice.
 */
export function paypalRequestId(
  orderId: string,
  operation: "create" | "authorize" | "capture" | "void" | "payout",
): string {
  return `${orderId}:${operation}`;
}

function invalid(message: string): EscrowError {
  return new EscrowError(422, message, "VALIDATION");
}

/** Map a PayPal/config failure onto an EscrowError; rethrow anything else. */
function fromPayPalFailure(err: unknown): never {
  if (err instanceof EscrowError) throw err;
  if (err instanceof PayPalError)
    throw new EscrowError(err.status, "PayPal request failed", "PAYPAL", {
      cause: err,
    });
  if (err instanceof Error && err.message.includes("must be set"))
    throw new EscrowError(
      503,
      "PayPal not configured (see .env.example)",
      "NOT_CONFIGURED",
      { cause: err },
    );
  throw err;
}

/** Create an escrow order for a dataset at its listed price. */
export async function createEscrowOrder(
  input: CreateEscrowOrderInput,
  deps: EscrowDeps = {},
): Promise<CreateEscrowOrderResult> {
  // Runtime guards: inputs may come straight from an HTTP body or a model's
  // tool call, so the static types are not trusted.
  const { datasetId, amount: clientAmount } = input as {
    datasetId: unknown;
    amount: unknown;
  };
  if (typeof datasetId !== "string" || datasetId.trim() === "")
    throw invalid("datasetId (string) is required");
  if (
    clientAmount !== undefined &&
    (typeof clientAmount !== "number" || !(clientAmount > 0))
  )
    throw invalid("amount, if provided, must be a positive number");
  const buyerEmail =
    typeof input.buyerEmail === "string" && input.buyerEmail.trim() !== ""
      ? input.buyerEmail
      : DEFAULT_BUYER_EMAIL;

  // The dataset must exist (orders.dataset_id is a FK) — a clean 422 instead of
  // a DB-level foreign-key throw.
  const dataset = withDb((db) => getDataset(db, datasetId));
  if (!dataset) throw invalid(`unknown datasetId: ${datasetId}`);

  // The server's listed price is the only source of the escrowed amount. A
  // client amount is compared in cents (no float equality) and must match.
  const amountCents = dataset.price_cents;
  if (!(amountCents > 0)) throw invalid("dataset has no listed price");
  if (
    typeof clientAmount === "number" &&
    Math.round(clientAmount * 100) !== amountCents
  )
    throw invalid("amount does not match the listed price");
  const amount = amountCents / 100;

  if (isMockMode()) {
    const paypalOrderId = mockId("MOCK-ORDER");
    const order = withDb((db) =>
      createOrder(db, {
        datasetId,
        buyerEmail,
        amountCents,
        paypalOrderId,
        status: "MATCHED",
      }),
    );
    return {
      orderId: order.id,
      paypalOrderId,
      status: "CREATED",
      approveUrl: `https://sandbox.paypal.com/checkoutnow?token=${paypalOrderId}`,
      escrowState: order.status,
      mock: true,
    };
  }

  try {
    // Mint our order id up front so the PayPal create call can carry an
    // idempotency key derived from it.
    const orderId = `ord_${randomUUID()}`;
    const pp = (deps.paypal ?? payPalClientFromEnv)();
    const ppOrder = await pp.createAuthorizeOrder({
      amount,
      currency: typeof input.currency === "string" ? input.currency : undefined,
      referenceId:
        typeof input.referenceId === "string" ? input.referenceId : undefined,
      requestId: paypalRequestId(orderId, "create"),
    });
    // Persist only after PayPal confirms the order — no dangling rows.
    const order = withDb((db) =>
      createOrder(db, {
        id: orderId,
        datasetId,
        buyerEmail,
        amountCents,
        paypalOrderId: ppOrder.orderId,
        status: "MATCHED",
      }),
    );
    return {
      orderId: order.id,
      paypalOrderId: ppOrder.orderId,
      status: ppOrder.status,
      approveUrl: ppOrder.approveUrl,
      escrowState: order.status,
    };
  } catch (err) {
    return fromPayPalFailure(err);
  }
}

/** Resolve an action (+ resolution) to its state-machine event, or throw 422. */
function eventFor(action: unknown, resolution: unknown): EscrowEvent {
  if (action === "resolve") {
    if (resolution !== "capture" && resolution !== "void")
      throw invalid('resolve requires resolution: "capture" or "void"');
    return resolution === "capture" ? "RESOLVE_CAPTURE" : "RESOLVE_VOID";
  }
  const event =
    typeof action === "string" && Object.hasOwn(ACTION_EVENT, action)
      ? ACTION_EVENT[action as keyof typeof ACTION_EVENT]
      : undefined;
  if (!event)
    throw invalid(`action must be one of: ${ESCROW_ACTIONS.join(", ")}`);
  return event;
}

/** Advance a stored escrow order by one action. */
export async function advanceEscrowOrder(
  input: AdvanceEscrowOrderInput,
  deps: EscrowDeps = {},
): Promise<AdvanceEscrowOrderResult> {
  const event = eventFor(input.action, input.resolution);

  const orderId: unknown = input.orderId;
  if (typeof orderId !== "string" || orderId.trim() === "")
    throw invalid("orderId is required");

  const order = withDb((db) => getOrder(db, orderId));
  if (!order)
    throw new EscrowError(404, `unknown orderId: ${orderId}`, "NOT_FOUND");

  // Validate BEFORE any PayPal call so an illegal move never charges anyone.
  // (advanceOrder re-validates inside the write as well.)
  try {
    transition(order.status, event);
  } catch (err) {
    if (err instanceof InvalidTransitionError)
      throw new EscrowError(409, err.message, "INVALID_TRANSITION", {
        cause: err,
      });
    throw err;
  }

  const note =
    typeof input.note === "string" && input.note.trim() !== ""
      ? input.note.trim().slice(0, MAX_NOTE)
      : undefined;
  // Persist the advance (optionally patching PayPal ids) once the money move
  // has succeeded.
  const advance = (patch?: OrderPatch) =>
    withDb((db) => advanceOrder(db, orderId, event, patch, note));
  const done = (
    row: OrderRow,
    extra: Omit<AdvanceEscrowOrderResult, "order" | "escrowState"> = {},
  ): AdvanceEscrowOrderResult => ({
    order: row,
    escrowState: row.status,
    ...extra,
  });

  // DELIVER and DISPUTE are internal state changes — no PayPal, in either mode.
  if (event === "DELIVER" || event === "DISPUTE")
    return done(advance(), isMockMode() ? { mock: true } : {});

  // MOCK MODE: deterministic-shape ids, no PayPal client, no network.
  if (isMockMode()) {
    if (event === "AUTHORIZE") {
      const authorizationId = mockId("MOCK-AUTH");
      return done(advance({ authorizationId }), {
        authorizationId,
        status: "COMPLETED",
        mock: true,
      });
    }
    if (event === "CAPTURE" || event === "RESOLVE_CAPTURE")
      return done(advance(), {
        captureId: mockId("MOCK-CAP"),
        status: "COMPLETED",
        mock: true,
      });
    if (event === "PAYOUT")
      return done(advance(), {
        payoutBatchId: mockId("MOCK-PAYOUT"),
        status: "PENDING",
        mock: true,
      });
    // VOID or RESOLVE_VOID
    return done(advance(), { mock: true });
  }

  // REAL MODE: Payouts is the not-yet-built seam (deliberate, not a side effect).
  if (event === "PAYOUT")
    throw new EscrowError(
      501,
      "real PayPal Payouts not implemented",
      "NOT_IMPLEMENTED",
    );

  // Caller-supplied idempotency key wins; otherwise derive one per operation.
  const requestIdFor = (op: "authorize" | "capture" | "void") =>
    typeof input.requestId === "string" && input.requestId.trim() !== ""
      ? input.requestId
      : paypalRequestId(orderId, op);

  try {
    const pp = (deps.paypal ?? payPalClientFromEnv)();
    if (event === "AUTHORIZE") {
      if (!order.paypal_order_id)
        throw new EscrowError(
          409,
          "order has no PayPal order id to authorize",
          "PRECONDITION",
        );
      const auth = await pp.authorizeOrder(order.paypal_order_id, {
        requestId: requestIdFor("authorize"),
      });
      return done(advance({ authorizationId: auth.authorizationId }), {
        authorizationId: auth.authorizationId,
        status: auth.status,
      });
    }
    if (event === "CAPTURE" || event === "RESOLVE_CAPTURE") {
      if (!order.authorization_id)
        throw new EscrowError(
          409,
          "order has no authorization to capture",
          "PRECONDITION",
        );
      const cap = await pp.captureAuthorization(order.authorization_id, {
        requestId: requestIdFor("capture"),
      });
      return done(advance(), { captureId: cap.captureId, status: cap.status });
    }
    // VOID or RESOLVE_VOID
    if (!order.authorization_id)
      throw new EscrowError(
        409,
        "order has no authorization to void",
        "PRECONDITION",
      );
    await pp.voidAuthorization(order.authorization_id, {
      requestId: requestIdFor("void"),
    });
    return done(advance());
  } catch (err) {
    return fromPayPalFailure(err);
  }
}
