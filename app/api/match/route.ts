// POST /api/match
// Takes a plain-English study description and returns candidate vendor
// datasets ranked by relevance (see lib/ai/matcher).
// Placeholder — no logic yet.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json(
    { ok: true, route: "match", received: body, matches: [] },
    { status: 501 },
  );
}
