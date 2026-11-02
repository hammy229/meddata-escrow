// Spending mandates: a buyer-signed policy that bounds what an agent may buy.
//
// A mandate is a small JSON policy (buyer, total cap, per-order cap, optional
// vendor / tag allow-lists, expiry) signed with HMAC-SHA256 under a server
// secret (env MANDATE_SECRET; a fixed dev fallback is used when unset, which
// is NOT safe for production). The token is `base64url(json).base64url(hmac)`.
// Anyone holding the token can present it, but nobody can widen it: any edit
// to the payload invalidates the signature.
//
// checkSpend is the pure ledger rule the buy path calls before money moves.
// Enforcement lives in code (lib/agent/tools.ts, lib/mcp), never in a prompt.
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import * as z from "zod/v4";

const DEV_SECRET = "meddata-escrow-dev-mandate-secret-not-for-production";
const MAX_TOKEN_CHARS = 4096;

export interface Mandate {
  id: string;
  buyerId: string;
  maxTotalCents: number;
  maxPerOrderCents: number;
  allowedVendors?: string[];
  allowedTags?: string[];
  issuedAt: string;
  expiresAt: string;
}

const Names = z.array(z.string().trim().min(1).max(200)).min(1).max(100);

const MandateShape = z.strictObject({
  id: z.string().min(1),
  buyerId: z.string().trim().min(1).max(320),
  maxTotalCents: z.int().positive(),
  maxPerOrderCents: z.int().positive(),
  allowedVendors: Names.optional(),
  allowedTags: Names.optional(),
  issuedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});

export interface IssueMandateInput {
  buyerId: string;
  maxTotalCents: number;
  /** Defaults to maxTotalCents. */
  maxPerOrderCents?: number;
  allowedVendors?: string[];
  allowedTags?: string[];
  /** ISO timestamp; must be in the future. */
  expiresAt: string;
}

export interface MandateOptions {
  /** Override the signing secret (tests). Defaults to env / dev fallback. */
  secret?: string;
  now?: Date;
}

function secretFor(opts: MandateOptions): string {
  return opts.secret ?? (process.env.MANDATE_SECRET?.trim() || DEV_SECRET);
}

function sign(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

/** Create and sign a mandate. Throws "invalid mandate: ..." on bad input. */
export function issueMandate(
  input: IssueMandateInput,
  opts: MandateOptions = {},
): { token: string; mandate: Mandate } {
  const now = opts.now ?? new Date();
  const candidate = {
    id: `mdt_${randomUUID()}`,
    buyerId: input.buyerId,
    maxTotalCents: input.maxTotalCents,
    maxPerOrderCents: input.maxPerOrderCents ?? input.maxTotalCents,
    ...(input.allowedVendors ? { allowedVendors: input.allowedVendors } : {}),
    ...(input.allowedTags ? { allowedTags: input.allowedTags } : {}),
    issuedAt: now.toISOString(),
    expiresAt: input.expiresAt,
  };
  const parsed = MandateShape.safeParse(candidate);
  const fail = (msg: string) => {
    throw new Error(`invalid mandate: ${msg}`);
  };
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return fail(`${i.path.join(".") || "input"} ${i.message}`);
  }
  const mandate = parsed.data;
  if (mandate.maxPerOrderCents > mandate.maxTotalCents)
    fail("maxPerOrderCents cannot exceed maxTotalCents");
  if (Date.parse(mandate.expiresAt) <= now.getTime())
    fail("expiresAt must be in the future");

  const payload = Buffer.from(JSON.stringify(mandate)).toString("base64url");
  const sig = sign(payload, secretFor(opts)).toString("base64url");
  return { token: `${payload}.${sig}`, mandate };
}

export type VerifyResult =
  { ok: true; mandate: Mandate } | { ok: false; reason: string };

/** Check signature (constant time), shape and expiry. Never throws. */
export function verifyMandate(
  token: string,
  opts: MandateOptions = {},
): VerifyResult {
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS)
    return { ok: false, reason: "malformed mandate token" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1])
    return { ok: false, reason: "malformed mandate token" };
  const [payload, sig] = parts;

  const expected = sign(payload, secretFor(opts));
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return { ok: false, reason: "invalid mandate signature" };

  let parsed: ReturnType<typeof MandateShape.safeParse>;
  try {
    parsed = MandateShape.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    return { ok: false, reason: "malformed mandate token" };
  }
  if (!parsed.success) return { ok: false, reason: "malformed mandate token" };

  const now = (opts.now ?? new Date()).getTime();
  if (Date.parse(parsed.data.expiresAt) < now)
    return { ok: false, reason: "mandate expired" };
  return { ok: true, mandate: parsed.data };
}

export interface MandateDataset {
  id: string;
  vendorId: string;
  tags: readonly string[];
}

export type SpendDecision = { allow: true } | { allow: false; reason: string };

/**
 * Would buying `dataset` at `priceCents` fit the mandate, given what it has
 * already spent? Pure; the caller owns the ledger (spentSoFar).
 */
export function checkSpend(
  mandate: Mandate,
  spentSoFar: number,
  priceCents: number,
  dataset: MandateDataset,
  now: Date = new Date(),
): SpendDecision {
  const deny = (reason: string): SpendDecision => ({ allow: false, reason });
  if (Date.parse(mandate.expiresAt) < now.getTime())
    return deny("mandate expired");
  if (!Number.isInteger(priceCents) || priceCents <= 0)
    return deny(`invalid price: ${priceCents}`);
  if (!Number.isInteger(spentSoFar) || spentSoFar < 0)
    return deny(`invalid spend ledger: ${spentSoFar}`);
  if (priceCents > mandate.maxPerOrderCents)
    return deny(
      `price ${priceCents} cents exceeds the mandate's per-order limit of ${mandate.maxPerOrderCents} cents`,
    );
  const remaining = mandate.maxTotalCents - spentSoFar;
  if (priceCents > remaining)
    return deny(
      `price ${priceCents} cents exceeds the mandate's remaining ${Math.max(remaining, 0)} cents (total ${mandate.maxTotalCents})`,
    );
  if (
    mandate.allowedVendors &&
    !mandate.allowedVendors.includes(dataset.vendorId)
  )
    return deny(`vendor ${dataset.vendorId} is not allowed by the mandate`);
  if (
    mandate.allowedTags &&
    !dataset.tags.some((t) => mandate.allowedTags!.includes(t))
  )
    return deny(
      `dataset ${dataset.id} has none of the mandate's allowed tags (${mandate.allowedTags.join(", ")})`,
    );
  return { allow: true };
}
