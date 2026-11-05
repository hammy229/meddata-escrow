// Dataset matcher.
//
// When the LLM is enabled (LLM_PROVIDER=bedrock), Claude on Bedrock ranks the
// catalog against the study description and explains each pick. The answer is
// validated here: unknown ids are dropped, duplicates collapsed, and any
// dataset Claude skipped is appended with score 0 and a keyword rationale, so
// the result always covers the whole catalog exactly once. When the LLM is off
// or the call fails, the deterministic BM25 keyword scorer (see ./matcher-bm25) is used
// instead, so the flow never depends on AWS.
import catalogData from "../../data/catalog.json";
import * as z from "zod/v4";

import { llmEnabled, structured, type LlmClient } from "../llm/client";
import { bm25Rank } from "./matcher-bm25";
import type { AiOptions } from "./options";

export interface DatasetMatch {
  datasetId: string;
  score: number;
  rationale: string;
  /** Which ranker produced this match ("keyword" for LLM-skipped entries). */
  source?: "llm" | "keyword";
}

export interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  tags: string[];
  recordCount: number;
}

export type { AiOptions };

export function loadCatalog(): CatalogEntry[] {
  return structuredClone(catalogData) as CatalogEntry[];
}

function keywordMatch(
  studyDescription: string,
  catalog: CatalogEntry[],
): DatasetMatch[] {
  return bm25Rank(studyDescription, catalog);
}

const Ranking = z.object({
  ranking: z.array(
    z.object({
      datasetId: z.string(),
      score: z.number().min(0).max(100),
      rationale: z.string(),
    }),
  ),
});

const RANK_SYSTEM =
  "You rank medical research datasets for a researcher's study. " +
  "Score each dataset 0-100 for how well it fits the study's population, " +
  "variables, and design. Give a 1-2 sentence rationale that cites the " +
  "study's specific needs. Use only dataset ids from the catalog provided " +
  "and include every dataset exactly once.";

async function llmMatch(
  studyDescription: string,
  catalog: CatalogEntry[],
  client?: LlmClient,
): Promise<DatasetMatch[]> {
  const listing = catalog.map(
    ({ id, title, description, tags, recordCount }) => ({
      id,
      title,
      description,
      tags,
      recordCount,
    }),
  );
  const { ranking } = await structured({
    operation: "match.rank",
    system: RANK_SYSTEM,
    prompt:
      `Study description:\n${studyDescription}\n\n` +
      `Catalog (JSON):\n${JSON.stringify(listing)}`,
    schema: Ranking,
    client,
  });

  // Validate against the real catalog: drop hallucinated ids, keep the first
  // occurrence of each id, then append anything the model left out.
  const known = new Set(catalog.map((d) => d.id));
  const seen = new Set<string>();
  const out: DatasetMatch[] = [];
  for (const r of ranking) {
    if (!known.has(r.datasetId) || seen.has(r.datasetId)) continue;
    seen.add(r.datasetId);
    out.push({
      datasetId: r.datasetId,
      score: r.score,
      rationale: r.rationale,
      source: "llm",
    });
  }
  const missing = catalog.filter((d) => !seen.has(d.id));
  // Score against the whole catalog (BM25 needs corpus statistics), then
  // keep only what the model skipped.
  const skipped = new Set(missing.map((d) => d.id));
  for (const m of keywordMatch(studyDescription, catalog)) {
    if (skipped.has(m.datasetId)) out.push({ ...m, score: 0 });
  }
  return out.sort((a, b) => b.score - a.score);
}

export async function matchDatasets(
  studyDescription: string,
  opts: AiOptions = {},
): Promise<DatasetMatch[]> {
  const { availableCatalog } = await import("../catalog/live");
  const catalog = await availableCatalog();
  if (opts.useLlm ?? llmEnabled()) {
    try {
      return await llmMatch(studyDescription, catalog, opts.client);
    } catch (err) {
      console.warn(
        `matcher: LLM ranking failed, using keyword match (${(err as Error).message})`,
      );
    }
  }
  return keywordMatch(studyDescription, catalog);
}
