// One-sentence summary of a query answer.
//
// The base layer is a deterministic, rule-based sentence built straight from
// the aggregate rows, so the no-LLM path (and every test) is stable. When the
// LLM is enabled, Claude may reword it, but only under a number guard: any
// number in the reworded sentence that is not in the rows or the rule-based
// text means the model invented a figure, and we keep the rule-based sentence.
// Cells below the privacy guard's minimum size are never quoted.
import * as z from "zod/v4";

import { llmEnabled, structured } from "../llm/client";
import type { AggregateRow } from "../query/mock-execute";
import type { CompiledQuery } from "./nl2query";
import type { AiOptions } from "./options";
import { MIN_CELL_SIZE } from "./privacy-guard";

const NUMBER_RE = /\d+(?:,\d{3})*(?:\.\d+)?/g;

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

// Numbers as bare digit strings (no thousands commas), for set comparison.
function numbersIn(text: string): string[] {
  return (text.match(NUMBER_RE) ?? []).map((n) =>
    String(Number(n.replace(/,/g, ""))),
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The aggregate value of a row: its count, or its avg_/min_/max_ column. */
function valueOf(row: AggregateRow): number | null {
  for (const [key, v] of Object.entries(row)) {
    if (key !== "group" && typeof v === "number") return v;
  }
  return null;
}

/**
 * Deterministic one-sentence summary of the result rows. Count cells below the
 * minimum cell size are left out and reported as withheld.
 */
export function ruleSummary(
  compiled: Pick<CompiledQuery, "plan">,
  rows: AggregateRow[],
): string {
  const plan = compiled.plan;
  const isCount = plan?.op === "count" || rows.some((r) => "count" in r);
  const usable = rows.filter((r) => {
    const v = valueOf(r);
    return v !== null && !(isCount && v < MIN_CELL_SIZE);
  });
  const withheld = rows.length - usable.length;
  const note =
    withheld > 0 ? ` (${plural(withheld, "group")} withheld for privacy)` : "";

  if (usable.length === 0) {
    return rows.length === 0
      ? "The query returned no rows."
      : "Every group was withheld for privacy.";
  }

  const field = plan?.field ?? "value";
  const by = plan?.groupBy ? plan.groupBy.replace(/_/g, " ") : null;
  const grouped = usable.some((r) => "group" in r);

  if (!grouped) {
    const v = valueOf(usable[0]) as number;
    if (isCount) return `There are ${fmt(v)} patients.`;
    const word = plan?.op === "avg" ? "average" : (plan?.op ?? "result");
    return `The ${word} ${field} is ${fmt(v)}.`;
  }

  const ranked = [...usable].sort(
    (a, b) => (valueOf(b) as number) - (valueOf(a) as number),
  );
  const top = ranked[0];
  const low = ranked[ranked.length - 1];
  if (isCount) {
    const total = usable.reduce((s, r) => s + (valueOf(r) as number), 0);
    return (
      `${fmt(total)} patients across ${plural(usable.length, "group")}` +
      `${by ? ` by ${by}` : ""}; the largest is ${top.group} with ` +
      `${fmt(valueOf(top) as number)}${note}.`
    );
  }
  return (
    `The average ${field}${by ? ` by ${by}` : ""} ranges from ` +
    `${fmt(valueOf(low) as number)} (${low.group}) to ` +
    `${fmt(valueOf(top) as number)} (${top.group})${note}.`
  );
}

/** True when every number in `text` appears in the rows or the rule summary. */
export function numbersGrounded(
  text: string,
  rows: AggregateRow[],
  rule: string,
): boolean {
  const allowed = new Set([
    ...numbersIn(rule),
    ...rows.flatMap((r) => numbersIn(Object.values(r).join(" "))),
  ]);
  return numbersIn(text).every((n) => allowed.has(n));
}

const Reword = z.object({ summary: z.string() });

const SUMMARY_SYSTEM =
  "You reword a one-sentence summary of an aggregate query result for a " +
  "researcher. Keep it to a single plain sentence. Use only numbers that " +
  "appear in the summary or the rows; never add, round, or compute new " +
  "figures. summary: the reworded sentence.";

export async function summarizeAnswer(
  question: string,
  compiled: Pick<CompiledQuery, "plan">,
  rows: AggregateRow[],
  opts: AiOptions = {},
): Promise<string> {
  const rule = ruleSummary(compiled, rows);
  if (!(opts.useLlm ?? llmEnabled())) return rule;
  try {
    const raw = await structured({
      system: SUMMARY_SYSTEM,
      prompt:
        `Question: ${question}\nSummary: ${rule}\n` +
        `Rows: ${JSON.stringify(rows)}`,
      schema: Reword,
      client: opts.client,
    });
    const text = Reword.parse(raw).summary.trim();
    if (text === "" || text.length > 300 || /[\r\n]/.test(text)) return rule;
    if (!numbersGrounded(text, rows, rule)) {
      console.warn("answer-summary: LLM sentence had an ungrounded number");
      return rule;
    }
    return text;
  } catch (err) {
    console.warn(
      `answer-summary: LLM reword failed, using rule summary (${(err as Error).message})`,
    );
    return rule;
  }
}
