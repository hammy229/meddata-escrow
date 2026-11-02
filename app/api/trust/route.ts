// GET /api/trust: explainable 0-100 trust scores (see lib/trust/score).
//   ?vendorId=..   -> { vendorId, name, trust }
//   ?datasetId=..  -> { datasetId, vendorId, title, trust }
//   (neither)      -> { vendors: [...], datasets: [...] }
// Read-only; unknown ids are 404, both ids at once is 422.
import { withDb } from "../../../lib/db/client";
import { datasetTrust, listTrust, vendorTrust } from "../../../lib/trust/load";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const vendorId = params.get("vendorId");
  const datasetId = params.get("datasetId");
  if (vendorId && datasetId)
    return Response.json(
      { error: "pass vendorId or datasetId, not both" },
      { status: 422 },
    );
  try {
    if (vendorId) {
      const t = withDb((db) => vendorTrust(db, vendorId));
      return t
        ? Response.json(t)
        : Response.json(
            { error: `unknown vendorId: ${vendorId}` },
            { status: 404 },
          );
    }
    if (datasetId) {
      const t = withDb((db) => datasetTrust(db, datasetId));
      return t
        ? Response.json(t)
        : Response.json(
            { error: `unknown datasetId: ${datasetId}` },
            { status: 404 },
          );
    }
    return Response.json(withDb((db) => listTrust(db)));
  } catch (err) {
    console.error("trust route error:", err);
    return Response.json({ error: "internal error" }, { status: 500 });
  }
}
