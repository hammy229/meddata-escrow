// POST /api/query  { orderId, datasetId, question }
// Runs a plain-English question against a purchased dataset and returns a
// privacy-safe aggregate. Pipeline:
//   0. entitlement  — the order must exist (404), be for this dataset (422),
//                     and be paid + delivered per grantsDataAccess (403).
//   1. checkQuestion — reject row-level / PII questions up front (403). Plain
//                      English is fine; no SQL syntax is required of the asker.
//   2. nl2query     — compile to parameterized, aggregate-only SQL, then
//                     re-check the COMPILED SQL with checkQuery (403) as
//                     defense in depth against a translator bug.
//   3. mockExecute  — the vendor-side aggregate query runs here (mock; no raw
//                     records ever leave the vendor).
//   4. checkResult  — small-cell suppression on the aggregate (403 if unsafe).
// Per-query billing is recorded separately via POST /api/billing after a
// successful query (keeps metering out of the read path).
import { nl2query } from "../../../lib/ai/nl2query";
import {
  checkQuery,
  checkQuestion,
  checkResult,
} from "../../../lib/ai/privacy-guard";
import { mockExecute } from "../../../lib/query/mock-execute";
import { getOrder, withDb } from "../../../lib/db/client";
import { grantsDataAccess } from "../../../lib/escrow/state-machine";

// Upper bound on a question. Real questions are a sentence or two; the cap keeps
// the regex screens and (later) the LLM prompt bounded against oversized input.
const MAX_QUESTION_LENGTH = 500;

// Same error shape as /api/orders: { error }.
function bad(error: string, status = 422) {
  return Response.json({ error }, { status });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const datasetId = body?.datasetId;
  const question = body?.question;
  const orderId = body?.orderId;
  if (
    typeof datasetId !== "string" ||
    datasetId.trim() === "" ||
    typeof question !== "string" ||
    question.trim() === "" ||
    typeof orderId !== "string" ||
    orderId.trim() === ""
  ) {
    return bad(
      "orderId, datasetId and question (non-empty strings) are required",
    );
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return bad(`question is too long (max ${MAX_QUESTION_LENGTH} characters)`);
  }

  // 0. Entitlement: only a paid, delivered order for THIS dataset may query it.
  //    The stored order row is the source of truth, never the client's claim.
  let order;
  try {
    order = withDb((db) => getOrder(db, orderId));
  } catch {
    return bad("could not load order", 500);
  }
  if (!order) return bad(`unknown orderId: ${orderId}`, 404);
  if (order.dataset_id !== datasetId) {
    return bad(`order ${orderId} is not for dataset ${datasetId}`);
  }
  if (!grantsDataAccess(order.status)) {
    return bad(
      `order does not grant data access (status ${order.status})`,
      403,
    );
  }

  // 1. Reject the question before compiling if it asks for row-level/PII data.
  const questionVerdict = await checkQuestion(question, datasetId);
  if (!questionVerdict.allowed) {
    return Response.json(
      { error: "query rejected", reasons: questionVerdict.reasons },
      { status: 403 },
    );
  }

  // 2. Compile to aggregate-only, parameterized SQL, then verify the SQL itself
  //    is aggregate and identifier-free (fail closed if the translator slips).
  const compiled = await nl2query(question, datasetId);
  const queryVerdict = await checkQuery(compiled.sql, datasetId);
  if (!queryVerdict.allowed) {
    return Response.json(
      { error: "query rejected", reasons: queryVerdict.reasons },
      { status: 403 },
    );
  }

  // 3. Execute the aggregate (mock vendor-side; raw records stay with vendor).
  const rows = mockExecute(compiled);

  // 4. Suppress if any aggregate cell is too small to be safe.
  const resultVerdict = await checkResult(rows);
  if (!resultVerdict.allowed) {
    return Response.json(
      { error: "result suppressed", reasons: resultVerdict.reasons },
      { status: 403 },
    );
  }

  return Response.json({
    datasetId,
    question,
    compiled,
    result: rows,
  });
}
