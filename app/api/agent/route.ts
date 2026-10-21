// /api/agent — the AI procurement agent (lib/agent).
//
//   POST { study, budgetCents, buyerEmail? }
//        study:       non-empty string, <= 1000 chars
//        budgetCents: positive integer (the most the agent may escrow)
//        buyerEmail:  optional email recorded on the order
//        -> 200 { runId, steps, recommendation: { datasetId, reasoning },
//                 order?: { orderId, datasetId, approveUrl, escrowState,
//                           amountCents },
//                 source: "llm" | "scripted" }
//        The agent may open at most one MATCHED escrow order; funds are held
//        only after the buyer approves at order.approveUrl. 422 on bad input.
//
//        Every run is saved to the agent_runs audit table (lib/agent/store)
//        before responding; if it cannot be saved, the request is a 500.
//
//   GET ?runId=run_...
//        -> 200 { runId, study, budgetCents, source, orderId, steps,
//                 recommendation, createdAt }   (the stored run)
//        404 unknown runId; 422 missing runId.
//
// Unexpected failures are logged server-side and returned as a generic 500.
import * as z from "zod/v4";

import { runProcurementAgent } from "../../../lib/agent/run";
import { getAgentRun, saveAgentRun } from "../../../lib/agent/store";

const Body = z.object({
  study: z.string().trim().min(1).max(1000),
  budgetCents: z.int().positive(),
  buyerEmail: z.email().optional(),
});

function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

function internalError(err: unknown): Response {
  console.error("agent route error:", err);
  return Response.json({ error: "internal error" }, { status: 500 });
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return bad(
      `${issue.path.join(".") || "body"}: ${issue.message}` +
        " (expected { study: non-empty string <= 1000 chars, budgetCents: positive integer, buyerEmail?: email })",
    );
  }
  try {
    const run = await runProcurementAgent(parsed.data);
    saveAgentRun(parsed.data, run);
    return Response.json(run);
  } catch (err) {
    return internalError(err);
  }
}

export async function GET(request: Request) {
  const runId = new URL(request.url).searchParams.get("runId")?.trim();
  if (!runId) return bad("runId query parameter is required");
  try {
    const run = getAgentRun(runId);
    if (!run) return bad(`unknown runId: ${runId}`, 404);
    return Response.json(run);
  } catch (err) {
    return internalError(err);
  }
}
