import { NextRequest, NextResponse } from "next/server";
import { downloadUrl, EscrowError } from "@/lib/escrow";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json({ url: downloadUrl(params.id) });
  } catch (e) {
    const msg = e instanceof EscrowError ? e.message : "error";
    return NextResponse.json({ error: msg }, { status: 403 });
  }
}
