import { executeDataset } from "../../../lib/sources/store";
// POST /api/query  { orderId, datasetId, question }
//                  or { orderId, datasetId, analysis: { type: "survival", groupBy } }
//   The analysis form is for SYNTHETIC fixture listings only and skips the
//   question steps below. groupBy is one of arm, sex, onset_site, age_band;
//   filters are refused. Same entitlement, cap and metering as an answer.
// Runs a plain-English question against a purchased dataset and returns a
// privacy-safe aggregate. Pipeline:
//   0. entitlement  — the order must exist (404), be for this dataset (422),
//                     and be paid + delivered per grantsDataAccess (403).
//   1. checkQuestion — reject row-level / PII questions up front (403). Plain
//                      English is fine; no SQL syntax is required of the asker.
//   2. nl2query     — compile to parameterized, aggregate-only SQL, then
//                     re-check the COMPILED SQL with checkQuery (403) as
//                     defense in depth against a translator bug.
//   3. execute      - the vendor-side aggregate query runs here, first match
//                     wins: a live provider database, then the dataset's
//                     SYNTHETIC fixture rows (a question those rows cannot
//                     answer is refused, unbilled), then the mock. No raw
//                     records ever leave the vendor.
//   4. checkResult  — small-cell suppression on the aggregate (403 if unsafe).
//      The 200 also carries a one-sentence `summary` of the rows.
//   5. recordUsage  — meter the answered query against the order at
//                     PER_QUERY_FEE_CENTS (lib/query/pricing). Only successful
//                     answers reach this step, so rejections are never billed.
import { summarizeAnswer } from "../../../lib/ai/answer-summary";
import { nl2query } from "../../../lib/ai/nl2query";
import {
  checkQuery,
  checkQuestion,
  checkResult,
  suggestRewrite,
} from "../../../lib/ai/privacy-guard";
import { executeFixture } from "../../../lib/query/fixture-execute";
import { fixtureCohort } from "../../../lib/fitness/source";
import {
  parseAnalysis,
  survivalAnalysis,
  type GroupBy,
} from "../../../lib/query/survival-analysis";
import { mockExecute } from "../../../lib/query/mock-execute";
import { getOrder, withDb } from "../../../lib/db/store";
import { recordUsage, queryCapStatus } from "../../../lib/db/store";
import { grantsDataAccess } from "../../../lib/escrow/state-machine";
import { PER_QUERY_FEE_CENTS } from "../../../lib/query/pricing";
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
  const orderId = body?.orderId;
  // `analysis` swaps the plain-English question for a fixed survival request.
  // The question text is then ours, never the client's.
  const hasAnalysis = body?.analysis !== undefined;
  let analysisGroupBy: GroupBy | null = null;
  if (hasAnalysis) {
    const parsed = parseAnalysis(body.analysis);
    if (!parsed.ok) return bad(parsed.error);
    analysisGroupBy = parsed.groupBy;
  }
  const question: unknown = hasAnalysis
    ? `Survival by ${analysisGroupBy} (synthetic)`
    : body?.question;
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
    order = await withDb(async (db) => await getOrder(db, orderId));
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
  // Spend cap: refuse before doing any work if one more query would push the
  // order past its cap. Never billed.
  let cap;
  try {
    cap = await withDb(
      async (db) => await queryCapStatus(db, order, PER_QUERY_FEE_CENTS),
    );
  } catch {
    return bad("could not check query cap", 500);
  }
  if (cap.exceeded) {
    return Response.json(
      {
        error: "query spend cap reached for this order",
        spentCents: cap.spentCents,
        capCents: cap.capCents,
      },
      { status: 402 },
    );
  }
  // Survival analysis: fixture listings only, a fixed grouping, metered like
  // any answer. Refusals are never billed.
  if (analysisGroupBy) {
    const cohort = fixtureCohort(datasetId, "delivery");
    if (!cohort)
      return bad(
        "Survival analysis is only available for synthetic fixture listings. No query charge was recorded.",
        422,
      );
    const outcome = survivalAnalysis(cohort, analysisGroupBy);
    if (outcome.kind === "refused")
      return Response.json(
        { error: "result suppressed", reasons: [outcome.reason] },
        { status: 403 },
      );
    let usage;
    try {
      usage = await withDb(
        async (db) =>
          await recordUsage(db, {
            orderId,
            question,
            chargeCents: PER_QUERY_FEE_CENTS,
          }),
      );
    } catch (err) {
      console.error(`query: could not record usage for ${orderId}:`, err);
      return bad("could not record query usage", 500);
    }
    return Response.json({
      datasetId,
      question,
      execution: "fixture",
      analysis: outcome.analysis,
      summary: outcome.analysis.interpretation,
      usage: { usageId: usage.id, chargeCents: usage.charge_cents },
    });
  }
  // 1. Reject the question before compiling if it asks for row-level/PII data.
  const questionVerdict = await checkQuestion(question, datasetId);
  if (!questionVerdict.allowed) {
    const suggestion = suggestRewrite(question, questionVerdict.reasons);
    return Response.json(
      {
        error: "query rejected",
        reasons: questionVerdict.reasons,
        ...(suggestion && { suggestion }),
      },
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
  let rows;
  let execution: "postgres" | "fixture" | "mock" = "mock";
  let executedSql: string | undefined;
  try {
    const live = compiled.plan
      ? await executeDataset(datasetId, compiled.plan)
      : null;
    if (live !== null) {
      rows = live.rows;
      executedSql = live.sql;
      execution = "postgres";
    } else {
      const fixture = compiled.plan
        ? executeFixture(datasetId, compiled.plan)
        : ({ kind: "none" } as const);
      if (fixture.kind === "refused") return bad(fixture.reason, 422);
      if (fixture.kind === "rows") {
        rows = fixture.rows;
        execution = "fixture";
      } else rows = mockExecute(compiled);
    }
  } catch (err) {
    // The client gets a generic 503; keep the cause in the server log so a
    // provider outage is visible to whoever runs the app.
    console.error(
      `query: provider execution failed for ${datasetId}:`,
      err instanceof Error ? err.message : err,
    );
    return bad(
      "The provider database could not answer this query. No query charge was recorded.",
      503,
    );
  }
  if (!rows.length)
    return bad(
      "No publishable aggregate is available; the cohort may be empty or below the minimum group size.",
      403,
    );
  // 4. Suppress if any aggregate cell is too small to be safe.
  const resultVerdict = await checkResult(rows);
  if (!resultVerdict.allowed) {
    return Response.json(
      { error: "result suppressed", reasons: resultVerdict.reasons },
      { status: 403 },
    );
  }
  // 5. Meter the answered query against the order. Only reached on success, so
  //    rejected and suppressed queries are never billed.
  let usage;
  try {
    usage = await withDb(
      async (db) =>
        await recordUsage(db, {
          orderId,
          question,
          chargeCents: PER_QUERY_FEE_CENTS,
        }),
    );
  } catch (err) {
    console.error(`query: could not record usage for ${orderId}:`, err);
    return bad("could not record query usage", 500);
  }
  const summary = await summarizeAnswer(question, compiled, rows);
  return Response.json({
    datasetId,
    question,
    compiled: { ...compiled, sql: executedSql ?? compiled.sql },
    result: rows,
    execution,
    summary,
    usage: { usageId: usage.id, chargeCents: usage.charge_cents },
  });
}
