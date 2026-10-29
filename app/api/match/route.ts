// POST /api/match  { description }
// Takes a plain-English study description and returns candidate vendor
// datasets ranked by relevance (lib/ai/matcher), each enriched with its
// catalog title and price so the researcher UI can show a buyable list. The
// price is the one stored in the database (what POST /api/orders charges, and
// what a vendor may have changed); catalog.json is only the fallback.
// Response: { matches, source } where source is "llm" when Claude on Bedrock
// ranked the catalog and "keyword" when the deterministic fallback did.
//
// POST /api/match  { sampleCheck: datasetId, description? }
// Runs the pre-capture sample quality + privacy check (lib/ai/sample-check) on
// a dataset's mock vendor sample, judged against the optional study
// description. Response: { sampleCheck: { passed, score, findings, source } };
// 404 for an unknown dataset. It lives on /api/match because it is the next
// step after picking a match, and keeps the AI endpoints in one route.
import { readFileSync } from "node:fs";

import { withDb } from "../../../lib/db/client";
import { priceMap } from "../../../lib/db/datasets";
import { matchDatasets } from "../../../lib/ai/matcher";
import { checkSample } from "../../../lib/ai/sample-check";

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

// Database prices by dataset id. An unreadable or unseeded database just means
// the catalog.json prices are shown, as before.
function loadPrices(): Map<string, number> {
  try {
    return withDb((db) => priceMap(db));
  } catch (err) {
    console.error("match route: could not read dataset prices:", err);
    return new Map();
  }
}

// Same error shape as /api/orders: { error }.
function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const description = body?.description;
  const catalog = loadCatalog();

  if (body?.sampleCheck !== undefined) {
    const datasetId = body.sampleCheck;
    if (typeof datasetId !== "string" || datasetId.trim() === "") {
      return bad("sampleCheck (non-empty dataset id) is required");
    }
    if (description !== undefined && typeof description !== "string") {
      return bad("description must be a string");
    }
    if (!catalog.has(datasetId)) {
      return bad(`unknown dataset: ${datasetId}`, 404);
    }
    const sampleCheck = await checkSample(datasetId, {
      studyDescription: description,
    });
    return Response.json({ sampleCheck });
  }

  if (typeof description !== "string" || description.trim() === "") {
    return bad("description (non-empty string) is required");
  }

  const ranked = await matchDatasets(description);
  const source = ranked.some((m) => m.source === "llm") ? "llm" : "keyword";
  const prices = loadPrices();
  const matches = ranked.map((m) => {
    const entry = catalog.get(m.datasetId);
    return {
      ...m,
      title: entry?.title ?? null,
      priceCents: prices.get(m.datasetId) ?? entry?.priceCents ?? null,
    };
  });

  return Response.json({ matches, source });
}
