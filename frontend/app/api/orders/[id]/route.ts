import { NextRequest, NextResponse } from "next/server";
import { getOrder } from "@/lib/escrow";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const order = getOrder(params.id);
  if (!order) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(order);
}
