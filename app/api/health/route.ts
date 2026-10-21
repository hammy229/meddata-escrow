// GET /api/health — liveness/readiness probe for uptime checks (e.g. Render's
// healthCheckPath).
//
//   200 { status: "ok",    mode: "mock" | "live", db: "ok" }
//   503 { status: "error", mode: "mock" | "live", db: "error" }
//
// Runs a trivial read (SELECT 1) through the normal DB path, so a missing or
// unopenable DATABASE_URL shows up here. `mode` reports PAYPAL_MODE only as
// mock/live — no credentials, paths, or error details are ever echoed.
import { withDb } from "../../../lib/db/client";
import { isMockMode } from "../../../lib/mock/ids";

// Never prerender or cache: every probe must actually touch the DB.
export const dynamic = "force-dynamic";

export async function GET() {
  const mode = isMockMode() ? "mock" : "live";
  try {
    withDb((db) => db.prepare("SELECT 1 AS ok").get());
  } catch (err) {
    // Log server-side for the operator; the response stays generic.
    console.error("health check: db error:", err);
    return Response.json(
      { status: "error", mode, db: "error" },
      { status: 503 },
    );
  }
  return Response.json({ status: "ok", mode, db: "ok" });
}
