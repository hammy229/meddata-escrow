import { availableCatalog } from "../../../lib/catalog/live";
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
//
// POST /api/match  { fitnessCheck: datasetId, description? }
// Runs the fitness screen (lib/fitness) on the SYNTHETIC sample rows and
// returns { fitnessCheck: FitnessReport | null }, null when the listing has no
// rows to screen. A screen, not proof. Same 404 / 422 as sampleCheck.
import { withDb } from "../../../lib/db/store";
import { priceMap } from "../../../lib/db/store";
import { matchDatasets } from "../../../lib/ai/matcher";
import { checkSample } from "../../../lib/ai/sample-check";
import { runFitnessAudit } from "../../../lib/fitness/audit";
import { fixtureCohort } from "../../../lib/fitness/source";
// The study the screen assumes when the buyer gave none.
const DEFAULT_STUDY = "Predict survival from baseline FVC and age at onset";
const MAX_STUDY_LENGTH = 500;
// Database prices by dataset id. An unreadable or unseeded database just means
// the catalog.json prices are shown, as before.
async function loadPrices(): Promise<Map<string, number>> {
  try {
    return await withDb(async (db) => await priceMap(db));
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
  const catalog = new Map((await availableCatalog()).map((d) => [d.id, d]));
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
  if (body?.fitnessCheck !== undefined) {
    const datasetId = body.fitnessCheck;
    if (typeof datasetId !== "string" || datasetId.trim() === "") {
      return bad("fitnessCheck (non-empty dataset id) is required");
    }
    if (description !== undefined && typeof description !== "string") {
      return bad("description must be a string");
    }
    if (!catalog.has(datasetId)) {
      return bad(`unknown dataset: ${datasetId}`, 404);
    }
    // Screens the sample rows a buyer may see before paying. Listing claims
    // are checked on delivery, not here. Null when the listing has no rows to
    // screen. The report holds findings and counts, never rows or subject keys.
    const cohort = fixtureCohort(datasetId, "sample");
    if (!cohort) return Response.json({ fitnessCheck: null });
    const study =
      typeof description === "string" && description.trim() !== ""
        ? description.slice(0, MAX_STUDY_LENGTH)
        : DEFAULT_STUDY;
    const fitnessCheck = runFitnessAudit({
      datasetId,
      stage: "sample",
      synthetic: cohort.synthetic,
      study,
      subjects: cohort.subjects,
      visits: cohort.visits,
      featureTiming: cohort.featureTiming,
    });
    return Response.json({ fitnessCheck });
  }
  if (typeof description !== "string" || description.trim() === "") {
    return bad("description (non-empty string) is required");
  }
  const ranked = await matchDatasets(description);
  const source = ranked.some((m) => m.source === "llm") ? "llm" : "keyword";
  const prices = await loadPrices();
  const matches = ranked.map((m) => {
    const entry = catalog.get(m.datasetId);
    return {
      ...m,
      title: entry?.title ?? null,
      priceCents:
        prices.get(m.datasetId) ??
        (entry as { priceCents?: number } | undefined)?.priceCents ??
        null,
      recordCount: entry?.recordCount ?? null,
    };
  });
  return Response.json({ matches, source });
}
