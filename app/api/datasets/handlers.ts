import { publishDataset } from "../../../lib/sources/store";
import { z } from "zod";
import type { Account } from "../../../lib/auth/store";
// /api/datasets — the catalog with the prices escrow orders actually charge.
//
//   GET   -> 200 { datasets: Dataset[] }   (lib/db/datasets)
//   PATCH { datasetId, priceCents }
//         -> 200 { dataset }               the repriced listing
//            400 { error }                 body is not { datasetId: string,
//                                          priceCents: number }
//            404 { error }                 unknown dataset
//            422 { error }                 price not whole cents in $1..$10,000
//
// The price lives in the database (datasets.price_cents), the same column
// POST /api/orders escrows, so a repriced listing is what the next order pays.
import { withDb } from "../../../lib/db/store";
import { listDatasets, updateDatasetPrice } from "../../../lib/db/store";
import { checkPriceCents } from "../../../lib/catalog/price-rules";
// Prices change at runtime; never prerender or cache.
export const dynamic = "force-dynamic";
function bad(error: string, status: number) {
  return Response.json({ error }, { status });
}
function internal(err: unknown) {
  console.error("datasets route error:", err);
  return Response.json({ error: "internal error" }, { status: 500 });
}
export async function GET(_request?: Request, account?: Account) {
  try {
    return Response.json({
      datasets: await withDb(async (db) =>
        (await listDatasets(db)).filter(
          (d) =>
            !account ||
            account.role !== "vendor" ||
            d.vendorId === account.vendor_id,
        ),
      ),
    });
  } catch (err) {
    return internal(err);
  }
}
export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return bad("body must be a JSON object", 400);
  }
  const { datasetId, priceCents } = body as Record<string, unknown>;
  if (typeof datasetId !== "string" || datasetId.trim() === "") {
    return bad("datasetId (non-empty string) is required", 400);
  }
  if (typeof priceCents !== "number") {
    return bad("priceCents (number) is required", 400);
  }
  const price = checkPriceCents(priceCents);
  if (!price.ok) return bad(price.error, 422);
  try {
    const dataset = await withDb(
      async (db) => await updateDatasetPrice(db, datasetId, price.priceCents),
    );
    if (!dataset) return bad(`unknown dataset: ${datasetId}`, 404);
    return Response.json({ dataset });
  } catch (err) {
    return internal(err);
  }
}

export async function POST(request: Request, account: Account) {
  try {
    const id = await publishDataset(account, await request.json());
    const dataset = await withDb(async (db) =>
      (await listDatasets(db)).find((d) => d.id === id),
    );
    return Response.json({ dataset }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return bad(err.issues[0].message, 400);
    const message = err instanceof Error ? err.message : "";
    return bad(
      /^(Dataset not found|Connection not found)/.test(message)
        ? message
        : "Could not publish this dataset. Verify the source connection, cohort key, and research view permissions.",
      400,
    );
  }
}
