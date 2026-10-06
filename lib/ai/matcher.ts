// Dataset matcher.
// Given a plain-English study description, uses the LLM to rank vendor
// datasets in the catalog by how well they fit the research need.
// Placeholder — no logic yet.

export interface DatasetMatch {
  datasetId: string;
  score: number;
  rationale: string;
}

export async function matchDatasets(
  _studyDescription: string,
): Promise<DatasetMatch[]> {
  // TODO: embed the description, score catalog entries, return ranked matches.
  throw new Error("matchDatasets not implemented");
}
