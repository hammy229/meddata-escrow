// GET /api/insights -> { insights: Insights }
//
// Marketplace roll-up for the /insights page: GMV held in escrow vs released,
// the platform fee earned, dispute rate, average time to deliver, orders by
// status, top datasets and per-vendor figures (lib/insights/summary). Read
// only; an empty book returns zeros. Never cached.
import { withDb } from "../../../lib/db/client";
import { loadInsights } from "../../../lib/insights/summary";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const insights = withDb((db) => loadInsights(db));
    return Response.json({ insights });
  } catch (err) {
    console.error("insights route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
