import { datasetSource } from "./store";
import { inspectSource, executeSource } from "./postgres";
import type { SampleCheck } from "../ai/sample-check";
export async function checkLiveSample(
  datasetId: string,
): Promise<SampleCheck | null> {
  const source = await datasetSource(datasetId);
  if (!source) return null;
  const { fields } = await inspectSource(source.config);
  const rows = await executeSource(source.config, source.datasetKey, {
    op: "count",
    field: null,
    groupBy: null,
  });
  const count = Number(rows[0]?.count ?? 0),
    passed = count >= 1000 && fields.length > 0;
  return {
    passed,
    score: passed ? 100 : 0,
    source: "rules",
    findings: [
      `${count >= 1000 ? "PASS" : "FAIL"} live cohort count ${count} (minimum 1000)`,
      `${fields.length ? "PASS" : "FAIL"} research view exposes ${fields.length} supported fields`,
      "Live count and view contract checked. Completeness, duplicates, and synthetic provenance require provider verification.",
    ],
  };
}
