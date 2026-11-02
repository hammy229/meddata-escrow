import type { Account } from "../../../lib/auth/store";
// GET /api/insights -> { insights: Insights }
//
// Marketplace roll-up for the /insights page: GMV held in escrow vs released,
// the platform fee earned, dispute rate, average time to deliver, orders by
// status, top datasets and per-vendor figures (lib/insights/summary). Read
// only; an empty book returns zeros. Never cached.
import { withDb } from "../../../lib/db/store";
import { loadAppInsights } from "../../../lib/insights/summary";

export const dynamic = "force-dynamic";

export async function GET(_request?: Request, account?: Account) {
  try {
    const insights = await withDb((db) => loadAppInsights(db, account));
    return Response.json({ insights });
  } catch (err) {
    console.error("insights route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
