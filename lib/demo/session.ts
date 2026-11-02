// Public walkthrough data is isolated per opaque browser session. It never
// resets or reads the authenticated app database, and runs only in mock mode.
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NextResponse } from "next/server";
import { databaseScope } from "../db/connection";
import { openDb } from "../db/client";
import { resetDemoData } from "../db/reset";
import { sameOrigin } from "../auth/access";
import { createRateLimiter, clientIp } from "../http/rate-limit";
import * as match from "../../app/api/match/handlers";
import * as orders from "../../app/api/orders/handlers";
import * as query from "../../app/api/query/handlers";
const cookie = "meddata_walkthrough";
const root = join(tmpdir(), "meddata-walkthroughs");
const limiter = createRateLimiter();
const ttl = 3600000;
const routes: Record<
  string,
  Partial<Record<string, (req: Request) => Promise<Response>>>
> = { match, orders, query };
/** An empty body or `{}` is a plain reset; `{"seed":"story"}` seeds the story
 * orders. Anything else is a typo we should report, not silently reset. */
async function readSeed(
  request: Request,
): Promise<{ story: boolean } | { error: string }> {
  const text = (await request.text()).trim();
  if (!text) return { story: false };
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "Body must be JSON" };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return { error: 'Body must be an object like {"seed":"story"}' };
  const seed = (body as { seed?: unknown }).seed;
  if (seed === undefined) return { story: false };
  if (seed === "story") return { story: true };
  return { error: 'Unknown seed; the only one is "story"' };
}

export async function handleDemoRequest(request: Request, path: string[]) {
  if (process.env.PAYPAL_MODE !== "mock")
    return NextResponse.json(
      { error: "Guided demo is available only in mock mode" },
      { status: 404 },
    );
  if (request.method !== "GET" && !sameOrigin(request))
    return NextResponse.json(
      { error: "Cross-site request rejected" },
      { status: 403 },
    );
  if (path.length !== 1)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const reset = path[0] === "reset" && request.method === "POST";
  if (
    !limiter.check(`${clientIp(request.headers)}:${reset ? "reset" : "step"}`, {
      limit: reset ? 5 : 60,
      windowMs: 60000,
    }).allowed
  )
    return NextResponse.json(
      { error: "Too many demo requests. Try again in a minute." },
      { status: 429 },
    );
  const supplied = request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${cookie}=`))
    ?.slice(cookie.length + 1);
  let id = supplied && /^[a-f0-9]{64}$/.test(supplied) ? supplied : undefined;
  if (reset) {
    // Check the body before touching any file, so a bad request changes nothing.
    const seed = await readSeed(request);
    if ("error" in seed)
      return NextResponse.json({ error: seed.error }, { status: 422 });
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const files = readdirSync(root).filter((f) =>
      /^[a-f0-9]{64}\.sqlite$/.test(f),
    );
    for (const file of files) {
      const target = join(root, file);
      if (Date.now() - statSync(target).mtimeMs > ttl)
        rmSync(target, { force: true });
    }
    if (
      (!id || !existsSync(join(root, `${id}.sqlite`))) &&
      readdirSync(root).length >= 100
    )
      return NextResponse.json(
        { error: "Demo capacity reached. Please try later." },
        { status: 503 },
      );
    id ??= randomBytes(32).toString("hex");
    const db = openDb(join(root, `${id}.sqlite`));
    try {
      resetDemoData(db, { story: seed.story });
    } finally {
      db.close();
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(cookie, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ttl / 1000,
      path: "/api/demo/session",
    });
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
  if (!id || !existsSync(join(root, `${id}.sqlite`)))
    return NextResponse.json(
      { error: "Start the guided demo first" },
      { status: 401 },
    );
  const handler = routes[path[0]]?.[request.method];
  if (!handler)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  const response = await databaseScope.run(join(root, `${id}.sqlite`), () =>
    handler(request),
  );
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/** Release an isolated walkthrough fixture; no authenticated app data is touched. */
export function discardDemoSession(id: string) {
  if (/^[a-f0-9]{64}$/.test(id))
    rmSync(join(root, `${id}.sqlite`), { force: true });
}
