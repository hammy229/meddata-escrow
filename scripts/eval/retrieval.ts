// Run the retrieval eval and write evals/results/retrieval.json.
//   node --import tsx --env-file-if-exists=.env.local scripts/eval/retrieval.ts
// Claude is scored only if LLM_PROVIDER=bedrock; otherwise the report says so.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  runRetrieval,
  type RankerResult,
  type RetrievalReport,
} from "../../lib/eval/retrieval";

export const RESULT_PATH = resolve(
  process.cwd(),
  "evals/results/retrieval.json",
);

const pct = (n: number | null) => (n === null ? "  n/a" : n.toFixed(3));

export function formatTable(
  report: RetrievalReport,
  results: RankerResult[] = report.results,
): string {
  const head = [
    "ranker".padEnd(18),
    "MRR".padStart(6),
    "R@1".padStart(6),
    "R@3".padStart(6),
    "nDCG@3".padStart(7),
    "noAns>0".padStart(8),
    "errors".padStart(7),
  ].join(" ");
  const rows = results.map((r) =>
    [
      r.ranker.padEnd(18),
      pct(r.metrics.mrr).padStart(6),
      pct(r.metrics.recallAt1).padStart(6),
      pct(r.metrics.recallAt3).padStart(6),
      pct(r.metrics.ndcgAt3).padStart(7),
      pct(r.noAnswer.falseRelevantRate).padStart(8),
      String(r.errors).padStart(7),
    ].join(" "),
  );
  return [head, ...rows].join("\n");
}

async function main(): Promise<void> {
  const report = await runRetrieval();
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  writeFileSync(RESULT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `${report.golden.answerable} answerable + ${report.golden.noAnswer} no-answer queries, ${report.catalogSize} listings`,
  );
  console.log(formatTable(report));
  console.log(
    `\nheld-out (${report.heldout.queries} queries written after the synonym map was frozen)`,
  );
  console.log(formatTable(report, report.heldout.results));
  console.log(`rankers run: ${report.rankersRun.join(", ")}`);
  for (const s of report.rankersSkipped)
    console.log(`skipped ${s.name}: ${s.reason}`);
  console.log(`wrote ${RESULT_PATH}`);
}

// Only run when executed directly, so tests can import formatTable.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(import.meta.filename)
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
