// POST /api/demo/reset -> { ok: true }
//
// Wipes orders, audit events, usage, agent runs and webhook dedupe rows and
// reseeds the catalog (lib/db/reset), so a demo can start over. Mock mode
// only: with PAYPAL_MODE unset or anything but "mock" it is 404 { error }, so
// a real deployment can never be wiped from here.
//
// Optional JSON body { "seed": "story" } also inserts a few sample orders in
// different escrow states (lib/db/demo-story). No body is a plain reset; any
// other body is 422 { error } and nothing is touched.
import { withDb } from "../../../../lib/db/client";
import { resetDemoData } from "../../../../lib/db/reset";
import { isMockMode } from "../../../../lib/mock/ids";

export async function POST(req?: Request) {
  if (!isMockMode())
    return Response.json({ error: "not found" }, { status: 404 });

  let story = false;
  const raw = req ? await req.text() : "";
  if (raw.trim() !== "") {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    const seed =
      body && typeof body === "object"
        ? (body as { seed?: unknown }).seed
        : undefined;
    if (seed === "story") story = true;
    else if (seed !== undefined || body === undefined || typeof body !== "object")
      return Response.json(
        { error: 'seed, if provided, must be "story"' },
        { status: 422 },
      );
  }

  try {
    withDb((db) => resetDemoData(db, { story }));
    return Response.json({ ok: true });
  } catch (err) {
    console.error("demo reset error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
