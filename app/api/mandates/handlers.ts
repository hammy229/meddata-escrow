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
// The public route requires a researcher session and derives buyerId from it.
// This internal handler also supports isolated business-logic tests.
import * as z from "zod/v4";

import { issueMandate } from "../../../lib/agent/mandate";
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
    return Response.json(
      issueMandate({
        ...rest,
        buyerId: account?.email ?? buyerId ?? DEFAULT_BUYER_EMAIL,
        expiresAt:
          expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
      }),
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.startsWith("invalid mandate")) return bad(msg);
    console.error("mandates route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
