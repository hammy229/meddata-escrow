// A ranked shortlist of the datasets an agent run looked at, rebuilt from the
// run's recorded steps (search results, dataset inspections, sample checks and
// the order). Pure and derived: nothing extra is stored, so it works for runs
// saved before this existed.
import type { AgentStep } from "./tools";

export type SampleCheckResult = "passed" | "failed" | "not_run";

export interface ShortlistItem {
  datasetId: string;
  title: string | null;
  priceCents: number | null;
  /** Relevance score from the search step; null if it was never searched. */
  fitScore: number | null;
  sampleCheck: SampleCheckResult;
  withinBudget: boolean | null;
  /** One short sentence on why it ranks where it does. */
  reason: string;
  /** True for the dataset the run recommended / opened an order for. */
  chosen: boolean;
}

const MAX_REASON = 140;

function clip(text: string): string {
  return text.length > MAX_REASON ? `${text.slice(0, MAX_REASON - 1)}…` : text;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function obj(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

const str = (v: unknown) => (typeof v === "string" ? v : null);
const num = (v: unknown) => (typeof v === "number" ? v : null);

interface Draft extends Omit<ShortlistItem, "reason" | "chosen"> {
  rationale: string | null;
  failure: string | null;
  order: number;
}

/**
 * Rank the candidates in a run. Order: the chosen dataset, then those that
 * passed their sample check, then those within budget, then by fit score.
 */
export function buildShortlist(
  steps: AgentStep[],
  recommendation?: { datasetId: string | null } | null,
  budgetCents?: number,
): ShortlistItem[] {
  const drafts = new Map<string, Draft>();
  let ordered: string | null = null;

  const draft = (datasetId: string): Draft => {
    let d = drafts.get(datasetId);
    if (!d) {
      d = {
        datasetId,
        title: null,
        priceCents: null,
        fitScore: null,
        sampleCheck: "not_run",
        withinBudget: null,
        rationale: null,
        failure: null,
        order: drafts.size,
      };
      drafts.set(datasetId, d);
    }
    return d;
  };

  for (const step of steps) {
    if (step.error !== undefined) continue;
    const out = obj(step.output);
    if (step.tool === "search_datasets") {
      const matches = Array.isArray(out.matches) ? out.matches : [];
      for (const m of matches) {
        const o = obj(m);
        const id = str(o.datasetId);
        if (!id) continue;
        const d = draft(id);
        d.title = str(o.title) ?? d.title;
        d.priceCents = num(o.priceCents) ?? d.priceCents;
        d.fitScore = num(o.score) ?? d.fitScore;
        d.rationale = str(o.rationale) ?? d.rationale;
        if (typeof o.withinBudget === "boolean")
          d.withinBudget = o.withinBudget;
      }
    } else if (step.tool === "get_dataset") {
      const id = str(out.datasetId);
      if (!id) continue;
      const d = draft(id);
      d.title = str(out.title) ?? d.title;
      d.priceCents = num(out.priceCents) ?? d.priceCents;
      if (typeof out.withinBudget === "boolean")
        d.withinBudget = out.withinBudget;
    } else if (step.tool === "check_sample") {
      const id = str(out.datasetId);
      if (!id || typeof out.passed !== "boolean") continue;
      const d = draft(id);
      d.sampleCheck = out.passed ? "passed" : "failed";
      if (!out.passed) {
        const findings = Array.isArray(out.findings) ? out.findings : [];
        const fail = findings.find(
          (f): f is string => typeof f === "string" && f.startsWith("FAIL"),
        );
        d.failure = fail ? fail.replace(/^FAIL:\s*/, "") : null;
      }
    } else if (step.tool === "create_escrow_order") {
      ordered = str(out.datasetId) ?? ordered;
    }
  }

  const chosenId = recommendation?.datasetId ?? ordered;
  if (chosenId) draft(chosenId);

  const items: (ShortlistItem & { order: number })[] = [...drafts.values()].map(
    (d) => {
      const chosen = d.datasetId === chosenId;
      // A budget given by the caller settles flags the steps never carried.
      const withinBudget =
        d.withinBudget ??
        (budgetCents !== undefined && d.priceCents !== null
          ? d.priceCents <= budgetCents
          : null);
      let reason: string;
      if (chosen) {
        reason = `Chosen${d.rationale ? `: ${d.rationale}` : ", the best fit that cleared every check."}`;
      } else if (d.sampleCheck === "failed") {
        reason = `Failed its sample check${d.failure ? `: ${d.failure}` : "."}`;
      } else if (withinBudget === false) {
        reason =
          d.priceCents === null
            ? "No listed price, so it cannot be bought."
            : `Over budget at ${usd(d.priceCents)}.`;
      } else if (d.sampleCheck === "passed") {
        reason = "Passed its sample check but was not ordered.";
      } else {
        reason = d.rationale ?? "Seen in search, not examined further.";
      }
      return {
        datasetId: d.datasetId,
        title: d.title,
        priceCents: d.priceCents,
        fitScore: d.fitScore,
        sampleCheck: d.sampleCheck,
        withinBudget,
        reason: clip(reason),
        chosen,
        order: d.order,
      };
    },
  );

  const rank = (i: ShortlistItem) =>
    (i.chosen ? 4 : 0) +
    (i.sampleCheck === "passed" ? 2 : 0) +
    (i.withinBudget ? 1 : 0);
  items.sort(
    (a, b) =>
      rank(b) - rank(a) ||
      (b.fitScore ?? -1) - (a.fitScore ?? -1) ||
      a.order - b.order,
  );
  return items.map(({ order: _order, ...item }) => item);
}
