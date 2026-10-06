// POST /api/query
// Takes a plain-English query against a purchased dataset and returns a
// privacy-safe aggregate (see lib/ai/nl2query + lib/ai/privacy-guard).
// Each call is metered and billed per use via /api/billing.
// Placeholder — no logic yet.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json(
    { ok: true, route: "query", received: body, result: null },
    { status: 501 },
  );
}
