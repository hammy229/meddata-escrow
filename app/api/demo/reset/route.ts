// POST /api/demo/reset -> { ok: true }
//
// Wipes orders, audit events, usage, agent runs and webhook dedupe rows and
// reseeds the catalog (lib/db/reset), so a demo can start over. Mock mode
// only: with PAYPAL_MODE unset or anything but "mock" it is 404 { error }, so
// a real deployment can never be wiped from here.
import { withDb } from "../../../../lib/db/client";
import { resetDemoData } from "../../../../lib/db/reset";
import { isMockMode } from "../../../../lib/mock/ids";

export async function POST() {
  if (!isMockMode())
    return Response.json({ error: "not found" }, { status: 404 });
  try {
    withDb((db) => resetDemoData(db));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("demo reset error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
