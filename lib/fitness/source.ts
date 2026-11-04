// Where the rows behind a SYNTHETIC listing come from. A catalog entry with a
// `fixture` block names a seeded generator (lib/synth/als) and the variant to
// use at each stage. Nothing here reads a database or the network.
import catalogData from "../../data/catalog.json";
import { generateAlsCohort, type AlsCohort, type AlsVariant } from "../synth/als";
import type { ListingClaims } from "./types";

export interface FixtureStage {
  variant: AlsVariant;
  seed: number;
}

export interface FixtureSpec {
  kind: "als";
  subjects: number;
  /** What the buyer sees before purchase. */
  sample: FixtureStage;
  /** What is delivered after purchase. */
  delivery: FixtureStage;
}

interface CatalogRow {
  id: string;
  fixture?: FixtureSpec;
  claims?: ListingClaims;
}

const rows = catalogData as unknown as CatalogRow[];

export function fixtureSpec(datasetId: string): FixtureSpec | null {
  return rows.find((r) => r.id === datasetId)?.fixture ?? null;
}

export function listingClaims(datasetId: string): ListingClaims | null {
  return rows.find((r) => r.id === datasetId)?.claims ?? null;
}

const cache = new Map<string, AlsCohort>();

/** The synthetic cohort behind a listing at one stage, or null if it has no fixture. Cached. */
export function fixtureCohort(datasetId: string, stage: "sample" | "delivery"): AlsCohort | null {
  const spec = fixtureSpec(datasetId);
  if (!spec) return null;
  const key = `${datasetId}:${stage}`;
  let cohort = cache.get(key);
  if (!cohort) {
    const { variant, seed } = spec[stage];
    cohort = generateAlsCohort({ seed, variant, subjects: spec.subjects });
    cache.set(key, cohort);
  }
  return cohort;
}
