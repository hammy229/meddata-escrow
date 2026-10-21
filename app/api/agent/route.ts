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
// Unexpected failures are logged server-side and returned as a generic 500.
import * as z from "zod/v4";

import { runProcurementAgent } from "../../../lib/agent/run";

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
    return Response.json(await runProcurementAgent(parsed.data));
  } catch (err) {
    return internalError(err);
  }
}
