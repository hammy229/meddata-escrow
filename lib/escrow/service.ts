// Escrow service: the framework-free business logic behind /api/orders.
//
// Two operations, reusable by the HTTP route and by an AI procurement agent:
//
//   createEscrowOrder  -> PayPal Orders v2 order (intent=AUTHORIZE) + an
//                         `orders` row in MATCHED. The escrowed amount is
//                         ALWAYS the dataset's listed price; a caller `amount`
//                         is only a confirmation (mismatch = 422).
//   advanceEscrowOrder -> apply an action (authorize | deliver | capture |
//                         payout | void | dispute | cancel | resolve) to a
//                         stored order.
//                         The stored row is the source of truth for the `from`
//                         state and PayPal ids. The state-machine transition is
//                         validated BEFORE any PayPal call, so an illegal move
//                         never charges anyone and never writes. `payout`
//                         pays the vendor (amount minus PLATFORM_FEE_BPS, see
//                         ./fees) through the PayPal Payouts API.
//
// Failures are thrown as EscrowError with an HTTP-ish `status` and a stable
// `code`, so callers can map them without parsing messages. Anything else that
// escapes (e.g. the DB is unreachable) is unexpected.
//
// Every persisted creation/transition is announced via a signed, fire-and-
// forget outbound webhook (lib/events/outbound; no-op unless
// OUTBOUND_WEBHOOK_URL is set).
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
  getVendor,
  advanceOrder,
  type OrderRow,
  type OrderPatch,
} from "../db/client";
import { mockId, isMockMode } from "../mock/ids";
import { vendorPayoutCents } from "./fees";
import {
  emitEscrowTransition,
  type EscrowTransition,
} from "../events/outbound";
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
  cancel: "CANCEL",
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
  | "PRECONDITION" // order lacks a PayPal id / vendor payout email (409)
  | "PAYPAL" // PayPal returned non-2xx (PayPal's status)
  | "NOT_CONFIGURED"; // PayPal credentials missing (503)

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
  /**
   * Called after every persisted creation/transition; defaults to the
   * fire-and-forget signed outbound webhook (lib/events/outbound).
   */
  emit?: (transition: EscrowTransition) => void;
}

/**
 * Announce a persisted creation/transition. Fire-and-forget: never awaited,
 * never throws into the caller (the money already moved; a lost notification
 * must not turn into an error).
 */
export function announce(
  deps: EscrowDeps,
  row: OrderRow,
  event: EscrowEvent | "CREATE",
  from: EscrowState | null,
): void {
  const transition: EscrowTransition = {
    orderId: row.id,
    event,
    from,
    to: row.status,
    amountCents: row.amount_cents,
    datasetId: row.dataset_id,
  };
  try {
    if (deps.emit) deps.emit(transition);
    else void emitEscrowTransition(transition);
  } catch (err) {
    console.error("escrow transition announce failed:", err);
  }
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

/** Payouts sender_batch_id for an order — one payout batch per order, ever. */
export function payoutSenderBatchId(orderId: string): string {
  return `payout_${orderId}`;
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
    announce(deps, order, "CREATE", null);
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
    announce(deps, order, "CREATE", null);
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
  // has succeeded, then announce it.
  const advance = (patch?: OrderPatch) => {
    const row = withDb((db) => advanceOrder(db, orderId, event, patch, note));
    announce(deps, row, event, order.status);
    return row;
  };
  const done = (
    row: OrderRow,
    extra: Omit<AdvanceEscrowOrderResult, "order" | "escrowState"> = {},
  ): AdvanceEscrowOrderResult => ({
    order: row,
    escrowState: row.status,
    ...extra,
  });

  // DELIVER, DISPUTE and CANCEL are internal state changes — no PayPal, in
  // either mode (a MATCHED order was never authorized, so nothing is held).
  if (event === "DELIVER" || event === "DISPUTE" || event === "CANCEL")
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
    if (event === "PAYOUT") {
      const payoutBatchId = mockId("MOCK-PAYOUT");
      return done(advance({ payoutBatchId }), {
        payoutBatchId,
        status: "PENDING",
        mock: true,
      });
    }
    // VOID or RESOLVE_VOID
    return done(advance(), { mock: true });
  }

  // Caller-supplied idempotency key wins; otherwise derive one per operation.
  const requestIdFor = (op: "authorize" | "capture" | "void" | "payout") =>
    typeof input.requestId === "string" && input.requestId.trim() !== ""
      ? input.requestId
      : paypalRequestId(orderId, op);

  try {
    const pp = (deps.paypal ?? payPalClientFromEnv)();
    if (event === "PAYOUT") {
      // Pay the dataset's vendor its share (captured amount minus the
      // platform fee) at their PayPal email.
      const receiver = withDb((db) => {
        const dataset = getDataset(db, order.dataset_id);
        return dataset ? getVendor(db, dataset.vendor_id)?.payout_email : null;
      });
      if (!receiver)
        throw new EscrowError(
          409,
          "vendor has no payout email",
          "PRECONDITION",
        );
      const payout = await pp.createPayout({
        // Unique per order: PayPal refuses a second batch with the same id.
        senderBatchId: payoutSenderBatchId(orderId),
        receiver,
        amount: vendorPayoutCents(order.amount_cents) / 100,
        note: `MedData Escrow payout for order ${orderId}`,
        emailSubject: "You have a MedData Escrow payout",
        requestId: requestIdFor("payout"),
      });
      return done(advance({ payoutBatchId: payout.payoutBatchId }), {
        payoutBatchId: payout.payoutBatchId,
        status: payout.batchStatus,
      });
    }
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
