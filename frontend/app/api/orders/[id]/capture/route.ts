import { NextRequest, NextResponse } from "next/server";
import { getPayPal } from "@/lib/paypal";
import { getOrder, markFunded, EscrowError } from "@/lib/escrow";

// Mock-mode capture: the browser "approves", we capture + fund in one call.
// In sandbox mode the real PayPal webhook funds the escrow instead (see backend).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    await getPayPal().captureOrder(order.paypal_order_id);
    const funded = markFunded(order.paypal_order_id);
    return NextResponse.json(funded);
  } catch (e) {
    const msg = e instanceof EscrowError ? e.message : "capture failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
