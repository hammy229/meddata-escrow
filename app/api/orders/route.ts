// /api/orders
// Escrow lifecycle via PayPal authorize-then-capture (see lib/paypal/client):
//   POST  -> create an order and AUTHORIZE funds (held, not captured)
//   PATCH -> after the sample check, CAPTURE (pass) or VOID (fail)
// Placeholder — no logic yet.

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json(
    { ok: true, route: "orders", action: "authorize", received: body },
    { status: 501 },
  );
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => ({}));
  return Response.json(
    { ok: true, route: "orders", action: "capture-or-void", received: body },
    { status: 501 },
  );
}
