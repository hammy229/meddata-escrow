import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getPayPal } from "@/lib/paypal";
import { putOrder } from "@/lib/escrow";
import { getListing } from "@/lib/listings";
import { Order } from "@/lib/types";

export async function POST(req: NextRequest) {
  const b = await req.json();
  const listing = getListing(b.listing_id);
  if (!listing) return NextResponse.json({ error: "unknown listing" }, { status: 404 });

  const order_id = randomBytes(16).toString("hex");
  const pp = await getPayPal().createOrder(listing.price, order_id);

  const order: Order = {
    order_id,
    listing_id: listing.listing_id,
    buyer_id: b.buyer_id || "demo-buyer",
    seller_id: b.seller_id || "demo-seller",
    amount: listing.price,
    paypal_order_id: pp.id,
    approve_url: pp.approve_url,
    state: "PENDING_PAYMENT",
    created_at: Math.floor(Date.now() / 1000),
  };
  putOrder(order);
  return NextResponse.json(order);
}
