// Procurement agent tools: what the agent can see and do, and the guardrails
// that bound what it may spend.
//
// Four tools over the app's real domain functions (no parallel logic):
//   search_datasets     -> lib/ai/matcher matchDatasets
//   get_dataset         -> catalog entry + the DB's listed price
//   check_sample        -> lib/ai/sample-check checkSample
//   create_escrow_order -> lib/escrow/service createEscrowOrder
//
// create_escrow_order only opens a MATCHED escrow order and returns PayPal's
// approve URL: funds are held only after the human buyer approves in PayPal,
// and the agent has no tool to authorize, capture, or pay out.
//
// GUARDRAILS live here, in code, so they hold no matter what the model (or
// the scripted planner) asks for. An order is refused unless:
//   - the dataset exists in the DB (the escrowed price comes from there),
//   - its listed price is <= the run's budgetCents,
//   - a PASSING sample check for that dataset already ran in this run,
//   - no order has been created yet in this run (at most one per run).
// A refused call becomes an error tool result the model can read and react to;
// it never throws out of the loop.
//
// Every call — valid or not — is recorded as an AgentStep for the audit trail.
import type Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";

import { loadCatalog, matchDatasets, type CatalogEntry } from "../ai/matcher";
import { checkSample } from "../ai/sample-check";
import type { AiOptions } from "../ai/options";
import { getDataset, withDb } from "../db/client";
import {
  createEscrowOrder,
  EscrowError,
  type EscrowDeps,
} from "../escrow/service";
import type { EscrowState } from "../escrow/state-machine";

/** One recorded tool call (exactly one of output / error is set). */
export interface AgentStep {
  tool: string;
  input: unknown;
  output?: unknown;
  error?: string;
  /** ISO timestamp of when the call finished. */
  at: string;
}

export interface AgentOrder {
  orderId: string;
  datasetId: string;
  approveUrl: string | null;
  escrowState: EscrowState;
  amountCents: number;
}

/** Per-run state the guardrails consult. Create with createAgentContext. */
export interface AgentContext {
  readonly study: string;
  readonly budgetCents: number;
  readonly buyerEmail?: string;
  /** Options for the nested AI features (matcher, sample check). */
  readonly ai: AiOptions;
  readonly escrowDeps: EscrowDeps;
  readonly steps: AgentStep[];
  /** Dataset ids whose sample check passed earlier in this run. */
  readonly passedSamples: Set<string>;
  order?: AgentOrder;
}

export function createAgentContext(init: {
  study: string;
  budgetCents: number;
  buyerEmail?: string;
  ai?: AiOptions;
  escrowDeps?: EscrowDeps;
}): AgentContext {
  return {
    study: init.study,
    budgetCents: init.budgetCents,
    buyerEmail: init.buyerEmail,
    ai: init.ai ?? {},
    escrowDeps: init.escrowDeps ?? {},
    steps: [],
    passedSamples: new Set(),
  };
}

const MAX_SEARCH_RESULTS = 5;

const SearchInput = z.strictObject({
  study: z.string().trim().min(1).max(1000),
});
const DatasetInput = z.strictObject({ datasetId: z.string().trim().min(1) });
const SampleInput = z.strictObject({
  datasetId: z.string().trim().min(1),
  study: z.string().trim().min(1).max(1000),
});
const OrderInput = z.strictObject({
  datasetId: z.string().trim().min(1),
  justification: z.string().trim().min(1).max(1000),
});

function schema(
  properties: Record<string, { type: "string"; description: string }>,
): Anthropic.Tool.InputSchema {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** Tool definitions sent to Claude (strict schemas; inputs re-validated here). */
export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "search_datasets",
    description:
      "Rank the marketplace's medical research datasets against a study " +
      "description. Returns the top matches with id, title, relevance score, " +
      "rationale, listed price in cents, and whether it fits the budget.",
    input_schema: schema({
      study: { type: "string", description: "The study description." },
    }),
    strict: true,
  },
  {
    name: "get_dataset",
    description:
      "Full details of one dataset by id: title, description, tags, record " +
      "count, listed price in cents, and whether it fits the budget.",
    input_schema: schema({
      datasetId: { type: "string", description: "A dataset id from search." },
    }),
    strict: true,
  },
  {
    name: "check_sample",
    description:
      "Run the quality + privacy check on the vendor's sample of a dataset " +
      "for this study. An order can only be created for a dataset whose " +
      "sample check passed earlier in this run.",
    input_schema: schema({
      datasetId: { type: "string", description: "A dataset id from search." },
      study: { type: "string", description: "The study description." },
    }),
    strict: true,
  },
  {
    name: "create_escrow_order",
    description:
      "Open a PayPal escrow order for a dataset at its listed price. Funds " +
      "are held only after the buyer approves at the returned approveUrl. " +
      "Refused if the price exceeds the budget, the sample check has not " +
      "passed, or an order was already created in this run.",
    input_schema: schema({
      datasetId: { type: "string", description: "The dataset to buy." },
      justification: {
        type: "string",
        description: "Why this dataset fits the study (shown to the buyer).",
      },
    }),
    strict: true,
  },
];

/** A refusal or bad input the model should see as a tool error. */
class ToolError extends Error {}

function catalogEntry(datasetId: string): CatalogEntry | undefined {
  return loadCatalog().find((d) => d.id === datasetId);
}

/** The listed price the escrow would charge: the DB row is authoritative. */
function listedPriceCents(datasetId: string): number | null {
  const row = withDb((db) => getDataset(db, datasetId));
  if (row) return row.price_cents;
  const entry = catalogEntry(datasetId) as
    (CatalogEntry & { priceCents?: number }) | undefined;
  return typeof entry?.priceCents === "number" ? entry.priceCents : null;
}

function parse<S extends z.ZodType>(s: S, input: unknown): z.infer<S> {
  const r = s.safeParse(input);
  if (!r.success)
    throw new ToolError(
      `invalid input: ${r.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
    );
  return r.data;
}

async function searchDatasets(ctx: AgentContext, input: unknown) {
  const { study } = parse(SearchInput, input);
  const ranked = await matchDatasets(study, ctx.ai);
  const catalog = new Map(loadCatalog().map((d) => [d.id, d]));
  return {
    matches: ranked.slice(0, MAX_SEARCH_RESULTS).map((m) => {
      const priceCents = listedPriceCents(m.datasetId);
      return {
        datasetId: m.datasetId,
        title: catalog.get(m.datasetId)?.title ?? null,
        score: m.score,
        rationale: m.rationale,
        priceCents,
        withinBudget: priceCents !== null && priceCents <= ctx.budgetCents,
      };
    }),
    budgetCents: ctx.budgetCents,
  };
}

async function getDatasetDetails(ctx: AgentContext, input: unknown) {
  const { datasetId } = parse(DatasetInput, input);
  const entry = catalogEntry(datasetId);
  if (!entry) throw new ToolError(`unknown datasetId: ${datasetId}`);
  const priceCents = listedPriceCents(datasetId);
  return {
    datasetId: entry.id,
    title: entry.title,
    description: entry.description,
    tags: entry.tags,
    recordCount: entry.recordCount,
    priceCents,
    budgetCents: ctx.budgetCents,
    withinBudget: priceCents !== null && priceCents <= ctx.budgetCents,
  };
}

async function runSampleCheck(ctx: AgentContext, input: unknown) {
  const { datasetId, study } = parse(SampleInput, input);
  if (!catalogEntry(datasetId))
    throw new ToolError(`unknown datasetId: ${datasetId}`);
  const result = await checkSample(datasetId, {
    ...ctx.ai,
    studyDescription: study,
  });
  if (result.passed) ctx.passedSamples.add(datasetId);
  return { datasetId, ...result };
}

async function placeOrder(ctx: AgentContext, input: unknown) {
  const { datasetId } = parse(OrderInput, input);
  if (ctx.order)
    throw new ToolError(
      `an escrow order was already created in this run (${ctx.order.orderId}); at most one order per run`,
    );
  const dataset = withDb((db) => getDataset(db, datasetId));
  if (!dataset) throw new ToolError(`unknown datasetId: ${datasetId}`);
  if (dataset.price_cents > ctx.budgetCents)
    throw new ToolError(
      `price ${dataset.price_cents} cents exceeds the budget of ${ctx.budgetCents} cents`,
    );
  if (!ctx.passedSamples.has(datasetId))
    throw new ToolError(
      `no passing sample check for ${datasetId} in this run; run check_sample first`,
    );

  try {
    const created = await createEscrowOrder(
      { datasetId, buyerEmail: ctx.buyerEmail },
      ctx.escrowDeps,
    );
    ctx.order = {
      orderId: created.orderId,
      datasetId,
      approveUrl: created.approveUrl ?? null,
      escrowState: created.escrowState,
      amountCents: dataset.price_cents,
    };
    return {
      ...ctx.order,
      note: "Funds are held only after the buyer approves at approveUrl.",
    };
  } catch (err) {
    if (err instanceof EscrowError) throw new ToolError(err.message);
    throw err;
  }
}

const EXECUTORS: Record<
  string,
  (ctx: AgentContext, input: unknown) => Promise<unknown>
> = {
  search_datasets: searchDatasets,
  get_dataset: getDatasetDetails,
  check_sample: runSampleCheck,
  create_escrow_order: placeOrder,
};

export type ToolOutcome =
  { ok: true; output: unknown } | { ok: false; error: string };

/**
 * Run one tool call against the context and record it as a step. Never
 * throws: refusals and bad input become `{ ok: false, error }` (the model
 * sees the reason); unexpected failures are logged and reported generically.
 */
export async function executeTool(
  ctx: AgentContext,
  name: string,
  input: unknown,
): Promise<ToolOutcome> {
  let outcome: ToolOutcome;
  const exec = Object.hasOwn(EXECUTORS, name) ? EXECUTORS[name] : undefined;
  if (!exec) {
    outcome = { ok: false, error: `unknown tool: ${name}` };
  } else {
    try {
      outcome = { ok: true, output: await exec(ctx, input) };
    } catch (err) {
      if (err instanceof ToolError) {
        outcome = { ok: false, error: err.message };
      } else {
        console.error(`agent tool ${name} failed:`, err);
        outcome = { ok: false, error: "tool failed unexpectedly" };
      }
    }
  }
  ctx.steps.push({
    tool: name,
    input,
    ...(outcome.ok ? { output: outcome.output } : { error: outcome.error }),
    at: new Date().toISOString(),
  });
  return outcome;
}
