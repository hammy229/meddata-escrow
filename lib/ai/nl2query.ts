// Natural-language to query translator.
// Converts a researcher's plain-English question into a safe, parameterized
// query against a purchased dataset's schema.
// Placeholder — no logic yet.

export interface CompiledQuery {
  sql: string;
  params: unknown[];
}

export async function nl2query(
  _question: string,
  _datasetId: string,
): Promise<CompiledQuery> {
  // TODO: prompt the LLM with the dataset schema, validate, parameterize.
  throw new Error("nl2query not implemented");
}
