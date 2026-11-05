// Run the red-team scenarios and write evals/results/redteam.json.
//   node --import tsx scripts/eval/redteam.ts
// No model is called.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { runRedteam } from "../../lib/eval/redteam";

const OUT = resolve(process.cwd(), "evals/results/redteam.json");

async function main(): Promise<void> {
  const report = await runRedteam();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  for (const r of report.scenarios)
    console.log(
      `${r.status === "blocked" ? "blocked    " : "NOT BLOCKED"}  ${r.id.padEnd(36)} ${r.guard ?? "-"}`,
    );
  console.log(
    `\n${report.summary.blocked}/${report.summary.total} blocked; not blocked: ${report.notBlocked.join(", ") || "none"}`,
  );
  console.log("modelResistance: not_measured (no model was called)");
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
