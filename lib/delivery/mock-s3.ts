// MOCK dataset delivery.
//
// Stands in for an S3 presigned GET URL so today's flow delivers without AWS.
// The real version calls S3 getSignedUrl; keep this signature for the swap.
import { randomBytes } from "node:crypto";

export interface PresignedDelivery {
  url: string;
  /** ISO timestamp after which the link stops working. */
  expiresAt: string;
  mock: true;
}

/** Mint a short-lived delivery link for one order's dataset. */
export function presignDelivery(
  datasetId: string,
  opts: { orderId: string; ttlSeconds?: number },
): PresignedDelivery {
  const ttl = opts.ttlSeconds ?? 900;
  const expiresMs = Date.now() + ttl * 1000;
  const url = new URL(
    `https://mock-delivery.meddata.local/datasets/${encodeURIComponent(datasetId)}.tar.gz`,
  );
  url.searchParams.set("orderId", opts.orderId);
  url.searchParams.set("expires", String(Math.floor(expiresMs / 1000)));
  url.searchParams.set("signature", randomBytes(16).toString("hex"));
  return {
    url: url.toString(),
    expiresAt: new Date(expiresMs).toISOString(),
    mock: true,
  };
}

export function mockDeliveryUrl(
  datasetId: string,
  opts: { expiresInSeconds?: number } = {},
): string {
  const expires =
    Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 3600);
  const signature = randomBytes(16).toString("hex");
  const url = new URL(
    `https://mock-delivery.meddata.local/datasets/${encodeURIComponent(datasetId)}.tar.gz`,
  );
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}
