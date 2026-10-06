import { NextRequest, NextResponse } from "next/server";
import { confirmReceipt, EscrowError } from "@/lib/escrow";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(confirmReceipt(params.id));
  } catch (e) {
    const msg = e instanceof EscrowError ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 409 });
  }
}
