// The start of the note the system writes on a dispute that a delivery audit
// raised. Kept in its own module, free of imports, so code that only reads
// notes (the dispute arbiter) can tell system text from the buyer's own words
// without pulling in anything that writes to the database.

/** Start of the system note written on the DISPUTE an audit raises. */
export const AUDIT_NOTE_PREFIX = "Delivery audit:";

/** True for a note the system wrote, not the buyer. */
export function isSystemNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.startsWith(AUDIT_NOTE_PREFIX);
}
