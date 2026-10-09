// POST /api/match  { description }
// Takes a plain-English study description and returns candidate vendor
// datasets ranked by relevance (lib/ai/matcher), each enriched with its
// catalog title and price so the researcher UI can show a buyable list.
import { readFileSync } from "node:fs";

import { matchDatasets } from "../../../lib/ai/matcher";

interface CatalogEntry {
  id: string;
  title: string;
  priceCents: number;
}

const CATALOG_URL = new URL("../../../data/catalog.json", import.meta.url);

function loadCatalog(): Map<string, CatalogEntry> {
  const entries = JSON.parse(
    readFileSync(CATALOG_URL, "utf8"),
  ) as CatalogEntry[];
  return new Map(entries.map((e) => [e.id, e]));
}

// Same error shape as /api/orders: { error }.
function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const description = body?.description;
  if (typeof description !== "string" || description.trim() === "") {
    return bad("description (non-empty string) is required");
  }

  const catalog = loadCatalog();
  const matches = (await matchDatasets(description)).map((m) => {
    const entry = catalog.get(m.datasetId);
    return {
      ...m,
      title: entry?.title ?? null,
      priceCents: entry?.priceCents ?? null,
    };
  });

  return Response.json({ matches });
}
