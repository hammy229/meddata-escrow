// POST /api/escrow/sweep: act on escrow deadlines (lib/escrow/sweep). Meant for a
// scheduler such as a Render cron job, not a browser, so it takes a bearer secret
// instead of a session.
//
//   Authorization: Bearer $ESCROW_SWEEP_SECRET
//   -> 200 { released, refunded, needsReview, failed }
//   -> 401 wrong or missing secret; 503 when the secret isn't configured.
import { createHash, timingSafeEqual } from "node:crypto";

import { sweepEscrow } from "../../../../lib/escrow/sweep";

export const dynamic = "force-dynamic";

// Hashing first gives both sides the same length, so a wrong guess can't learn
// the secret's length from an early exit.
function matches(given: string, secret: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

export async function POST(request: Request) {
  const secret = process.env.ESCROW_SWEEP_SECRET?.trim();
  if (!secret)
    return Response.json(
      { error: "ESCROW_SWEEP_SECRET is not configured" },
      { status: 503 },
    );
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!matches(token, secret))
    return Response.json({ error: "Invalid sweep secret" }, { status: 401 });
  try {
    return Response.json(await sweepEscrow());
  } catch (err) {
    console.error("escrow sweep error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
