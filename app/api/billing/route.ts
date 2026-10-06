// POST /api/billing
// Records per-query usage and charges the researcher via PayPal (see
// lib/paypal/client). Called after a successful /api/query.
// Placeholder — no logic yet.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json(
    { ok: true, route: "billing", received: body, charge: null },
    { status: 501 },
  );
}
