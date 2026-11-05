// Run the audit eval on SYNTHETIC cohorts and write evals/results/audit.json.
//   node --import tsx scripts/eval/audit.ts [--seeds=200] [--out=path] [--no-write]
// Deterministic: the same seeds always give the same file.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  formatAuditTable,
  roundedForFile,
  runAuditEval,
} from "../../lib/eval/audit-eval";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const seeds = Number(arg("seeds") ?? 200);
const out = resolve(arg("out") ?? "evals/results/audit.json");
if (!Number.isInteger(seeds) || seeds < 1)
  throw new Error("--seeds must be a positive integer");

const started = Date.now();
const result = roundedForFile(runAuditEval({ seeds }));
console.log(formatAuditTable(result));
console.log(`\nran in ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (!process.argv.includes("--no-write")) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
