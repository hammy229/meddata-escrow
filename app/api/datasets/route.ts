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
import { withDb } from "../../../lib/db/client";
import { listDatasets, updateDatasetPrice } from "../../../lib/db/datasets";
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

export async function GET() {
  try {
    return Response.json({ datasets: withDb((db) => listDatasets(db)) });
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
    const dataset = withDb((db) =>
      updateDatasetPrice(db, datasetId, price.priceCents),
    );
    if (!dataset) return bad(`unknown dataset: ${datasetId}`, 404);
    return Response.json({ dataset });
  } catch (err) {
    return internal(err);
  }
}
