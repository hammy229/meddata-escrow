import type { Account } from "../../../lib/auth/store";
// /api/mandates: issue a signed spending mandate (lib/agent/mandate).
//
//   POST { maxTotalCents, maxPerOrderCents?, allowedVendors?, allowedTags?,
//          buyerId?, expiresAt? }
//        maxTotalCents:    positive integer, the most all orders may total
//        maxPerOrderCents: positive integer <= maxTotalCents (default: total)
//        allowedVendors / allowedTags: optional non-empty string arrays
//        buyerId:          who the mandate is for (default: the demo buyer)
//        expiresAt:        future ISO timestamp (default: one hour from now)
//        -> 200 { token, mandate }
//        Present `token` as `mandate` to POST /api/agent or to the MCP
//        place_escrow_order tool. 422 on bad input.
//
//   GET  -> 200 { mandates: MandateSummary[] } the caller's mandates, newest
//        first, with what each has spent and whether it is still usable.
//
//   DELETE ?mandateId=mdt_...
//        -> 200 { mandate: MandateSummary } the agent can no longer open orders
//        with it, right away, even with a valid token. Repeating it is a no-op.
//        Orders it already opened stay: only the buyer can approve those.
//        404 if it is not the caller's. (Not ?id=: secure() reads that as an
//        order id.)
//
// The public route requires a researcher session and derives buyerId from it.
// This internal handler also supports isolated business-logic tests.
import * as z from "zod/v4";

import { issueMandate } from "../../../lib/agent/mandate";
import {
  listMandates,
  revokeMandate,
  saveMandate,
} from "../../../lib/agent/mandate-store";
import { DEFAULT_BUYER_EMAIL } from "../../../lib/escrow/service";

const Names = z.array(z.string().trim().min(1).max(200)).min(1).max(100);

const Body = z.strictObject({
  maxTotalCents: z.int().positive(),
  maxPerOrderCents: z.int().positive().optional(),
  allowedVendors: Names.optional(),
  allowedTags: Names.optional(),
  buyerId: z.string().trim().min(1).max(320).optional(),
  expiresAt: z.iso.datetime().optional(),
});

const DEFAULT_TTL_MS = 60 * 60 * 1000;

function bad(error: string) {
  return Response.json({ error }, { status: 422 });
}

export async function POST(request: Request, account?: Account) {
  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return bad(
      `${issue.path.join(".") || "body"}: ${issue.message}` +
        " (expected { maxTotalCents: positive integer, maxPerOrderCents?, allowedVendors?, allowedTags?, buyerId?, expiresAt? })",
    );
  }
  const { buyerId, expiresAt, ...rest } = parsed.data;
  try {
    const issued = issueMandate({
      ...rest,
      buyerId: account?.email ?? buyerId ?? DEFAULT_BUYER_EMAIL,
      expiresAt:
        expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
    });
    await saveMandate(issued.mandate);
    return Response.json(issued);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("invalid mandate")) return bad(msg);
    console.error("mandates route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}

export async function GET(_request: Request, account?: Account) {
  try {
    return Response.json({
      mandates: await listMandates(account?.email ?? DEFAULT_BUYER_EMAIL),
    });
  } catch (err) {
    console.error("mandates route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, account?: Account) {
  const mandateId = new URL(request.url).searchParams.get("mandateId")?.trim();
  if (!mandateId) return bad("mandateId query parameter is required");
  try {
    const mandate = await revokeMandate(
      mandateId,
      account?.email ?? DEFAULT_BUYER_EMAIL,
    );
    if (!mandate)
      return Response.json({ error: "Mandate not found" }, { status: 404 });
    return Response.json({ mandate });
  } catch (err) {
    console.error("mandates route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
