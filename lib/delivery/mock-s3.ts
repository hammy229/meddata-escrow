// MOCK dataset delivery.
//
// Stands in for an S3 presigned GET URL so today's flow delivers without AWS.
// The real version calls S3 getSignedUrl; keep this signature for the swap.
import { randomBytes } from "node:crypto";

export function mockDeliveryUrl(
  datasetId: string,
  opts: { expiresInSeconds?: number } = {},
): string {
  const expires = Math.floor(Date.now() / 1000) + (opts.expiresInSeconds ?? 3600);
  const signature = randomBytes(16).toString("hex");
  const url = new URL(`https://mock-delivery.meddata.local/datasets/${encodeURIComponent(datasetId)}.tar.gz`);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("signature", signature);
  return url.toString();
}
