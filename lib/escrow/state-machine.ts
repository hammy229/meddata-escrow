// Escrow state machine for the PayPal authorize-then-capture flow.
//
//   MATCHED ──AUTHORIZE──> AUTHORIZED ──DELIVER──> DELIVERED ──CAPTURE──> CAPTURED ──PAYOUT──> PAID_OUT
//   MATCHED ──CANCEL─────> CANCELLED
//   AUTHORIZED ──VOID────> VOIDED
//   AUTHORIZED/DELIVERED ──DISPUTE──> DISPUTED ──RESOLVE_CAPTURE──> CAPTURED
//                                               └─RESOLVE_VOID────> VOIDED
//
// VOIDED, CANCELLED, PAID_OUT are terminal. Pure data — no I/O, no PayPal
// calls. The API layer maps PayPal webhooks/results onto these events.

export type EscrowState =
  | "MATCHED"
  | "AUTHORIZED"
  | "DELIVERED"
  | "CAPTURED"
  | "PAID_OUT"
  | "DISPUTED"
  | "VOIDED"
  | "CANCELLED";

export type EscrowEvent =
  | "AUTHORIZE"
  | "DELIVER"
  | "CAPTURE"
  | "PAYOUT"
  | "DISPUTE"
  | "RESOLVE_CAPTURE"
  | "RESOLVE_VOID"
  | "VOID"
  | "CANCEL";

const TRANSITIONS: Record<EscrowState, Partial<Record<EscrowEvent, EscrowState>>> = {
  MATCHED: { AUTHORIZE: "AUTHORIZED", CANCEL: "CANCELLED" },
  AUTHORIZED: { DELIVER: "DELIVERED", VOID: "VOIDED", DISPUTE: "DISPUTED" },
  DELIVERED: { CAPTURE: "CAPTURED", DISPUTE: "DISPUTED" },
  CAPTURED: { PAYOUT: "PAID_OUT" },
  DISPUTED: { RESOLVE_CAPTURE: "CAPTURED", RESOLVE_VOID: "VOIDED" },
  PAID_OUT: {},
  VOIDED: {},
  CANCELLED: {},
};

const TERMINAL_STATES: ReadonlySet<EscrowState> = new Set<EscrowState>([
  "PAID_OUT",
  "VOIDED",
  "CANCELLED",
]);

export class InvalidTransitionError extends Error {
  constructor(
    readonly state: EscrowState,
    readonly event: EscrowEvent,
  ) {
    super(`Invalid escrow transition: ${event} not allowed from ${state}`);
    this.name = "InvalidTransitionError";
  }
}

/** Next state for an event, or throw InvalidTransitionError if not allowed. */
export function transition(state: EscrowState, event: EscrowEvent): EscrowState {
  const next = TRANSITIONS[state][event];
  if (next === undefined) throw new InvalidTransitionError(state, event);
  return next;
}

/** Whether `event` is legal from `state` (no throw). */
export function can(state: EscrowState, event: EscrowEvent): boolean {
  return TRANSITIONS[state][event] !== undefined;
}

/** Whether `state` is terminal (no outgoing transitions). */
export function isTerminal(state: EscrowState): boolean {
  return TERMINAL_STATES.has(state);
}
