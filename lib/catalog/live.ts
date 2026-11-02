import { loadCatalog, type CatalogEntry } from "../ai/matcher";
import { withDb, listDatasets } from "../db/store";
import { isPostgres } from "../db/connection";
export async function availableCatalog(): Promise<CatalogEntry[]> {
  const base = loadCatalog();
  try {
    const listings = await withDb((db) => listDatasets(db));
    const known = new Set(base.map((d) => d.id));
    return [
      ...base,
      ...listings
        .filter((d) => !known.has(d.id))
        .map((d) => ({
          id: d.id,
          title: d.title,
          description: d.description ?? "",
          tags: d.tags,
          recordCount: d.recordCount ?? 0,
        })),
    ];
  } catch (error) {
    if (isPostgres()) throw error;
    return base;
  }
}
