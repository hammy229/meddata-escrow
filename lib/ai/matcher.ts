// Dataset matcher.
//
// MOCK (stub for Bedrock): deterministic keyword/tag overlap scoring over the
// local catalog, so today's flow runs with no AWS. The real version prompts
// Claude on Bedrock to rank datasets; keep this signature so the swap is local.
import { readFileSync } from "node:fs";

export interface DatasetMatch {
  datasetId: string;
  score: number;
  rationale: string;
}

interface CatalogEntry {
  id: string;
  title: string;
  description: string;
  tags: string[];
}

const CATALOG_URL = new URL("../../data/catalog.json", import.meta.url);

function loadCatalog(): CatalogEntry[] {
  return JSON.parse(readFileSync(CATALOG_URL, "utf8")) as CatalogEntry[];
}

// Lowercase word tokens of length >= 3 (drops noise like "2", "of", "a").
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 3,
  );
}

export async function matchDatasets(
  studyDescription: string,
): Promise<DatasetMatch[]> {
  const query = new Set(tokens(studyDescription));
  const catalog = loadCatalog();

  return catalog
    .map((d) => {
      const haystack = new Set(
        tokens(`${d.title} ${d.description} ${d.tags.join(" ")}`),
      );
      const matched = [...query].filter((t) => haystack.has(t));
      return {
        datasetId: d.id,
        score: matched.length,
        rationale: matched.length
          ? `Matched on: ${matched.join(", ")}`
          : "No direct keyword overlap",
      };
    })
    .sort((a, b) => b.score - a.score);
}
