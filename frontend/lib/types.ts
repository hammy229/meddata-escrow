// Shared types for MedData Escrow.

export type EscrowState =
  | "PENDING_PAYMENT"
  | "FUNDED"
  | "RELEASED"
  | "REFUNDED"
  | "CANCELLED";

export interface Listing {
  listing_id: string;
  title: string;
  description: string;
  price: string; // USD, e.g. "250.00"
  tags: string[];
}

export interface Order {
  order_id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  amount: string;
  paypal_order_id: string;
  approve_url: string;
  state: EscrowState;
  created_at: number;
  funded_at?: number;
  released_at?: number;
}

export interface Match {
  listing_id: string;
  score: number;
  reason: string;
}
