// PayPal authorization window: how long an authorized hold can still be
// captured. PayPal honors a hold for 3 days (funds are guaranteed to be
// there), keeps it valid for up to 29 days (capture may still work but is no
// longer guaranteed), and after that it is expired and must be reauthorized.
//
// Pure — no I/O. Callers pass the authorize time and the clock.

export const HONOR_DAYS = 3;
export const VALID_DAYS = 29;

const DAY_MS = 24 * 60 * 60 * 1000;

export type AuthWindowState = "honor" | "valid" | "expired";

export interface AuthWindow {
  /** ISO-8601 time the hold was authorized. */
  authorizedAt: string;
  /** ISO-8601 end of the 3-day honor period. */
  honorUntil: string;
  /** ISO-8601 end of the 29-day validity period. */
  expiresAt: string;
  state: AuthWindowState;
  /** Whole days left until `expiresAt` (rounded up); 0 once expired. */
  daysLeft: number;
}

/**
 * Parse a Date, ISO string, or a SQLite `CURRENT_TIMESTAMP` value
 * (`YYYY-MM-DD HH:MM:SS`, UTC with no zone marker). Returns null if invalid.
 */
function toDate(value: Date | string): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const bare = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value);
  const d = new Date(bare ? `${value.replace(" ", "T")}Z` : value);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * The authorization window for a hold authorized at `authorizedAt`, as of
 * `now`. Returns null when either time is missing or unparseable.
 */
export function authorizationWindow(
  authorizedAt: Date | string | null | undefined,
  now: Date | string = new Date(),
): AuthWindow | null {
  if (authorizedAt == null) return null;
  const start = toDate(authorizedAt);
  const current = toDate(now);
  if (!start || !current) return null;

  const honorUntil = new Date(start.getTime() + HONOR_DAYS * DAY_MS);
  const expiresAt = new Date(start.getTime() + VALID_DAYS * DAY_MS);
  const t = current.getTime();
  const state: AuthWindowState =
    t < honorUntil.getTime()
      ? "honor"
      : t < expiresAt.getTime()
        ? "valid"
        : "expired";
  return {
    authorizedAt: start.toISOString(),
    honorUntil: honorUntil.toISOString(),
    expiresAt: expiresAt.toISOString(),
    state,
    daysLeft: Math.max(0, Math.ceil((expiresAt.getTime() - t) / DAY_MS)),
  };
}
