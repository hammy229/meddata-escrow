import { NextRequest, NextResponse } from "next/server";
import { keywordMatch } from "@/lib/matcher";
import { LISTINGS } from "@/lib/listings";

export async function POST(req: NextRequest) {
  const { request } = await req.json().catch(() => ({ request: "" }));
  const matches = keywordMatch(request || "", LISTINGS);
  return NextResponse.json({ matches });
}
