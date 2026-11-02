// Audit store for procurement agent runs: every run (its full tool-call trace
// and recommendation) is saved so a buyer or reviewer can later see exactly
// what the agent did before an escrow order appeared.
//
// WHY THE TABLE IS CREATED HERE and not in lib/db/schema.sql: schema.sql is
// owned by the backend/DB lane, and the agent lane may not edit it. The table
// is self-contained (no FKs into other tables), so it is created idempotently
// with CREATE TABLE IF NOT EXISTS on the same connection right before each
// read/write. If it later moves into schema.sql, this statement becomes a
// harmless no-op. `recommendation_json` keeps the agent's reasoning, the part
// of a run an auditor most needs.
import type { AppDatabase as DatabaseSync } from "../db/connection";
import { withDb } from "../db/store";
import type { AgentStep } from "./tools";
import type { AgentRunInput, AgentRunResult } from "./run";
const DDL = `CREATE TABLE IF NOT EXISTS agent_runs (
  id                  TEXT PRIMARY KEY,
  study               TEXT,
  budget_cents        INTEGER,
  source              TEXT,
  order_id            TEXT NULL,
  steps_json          TEXT,
  recommendation_json TEXT,
  created_at          TEXT DEFAULT CURRENT_TIMESTAMP
)`;
async function ensureTable(db: DatabaseSync): Promise<void> {
  await db.exec(DDL);
}
/** A stored run, as returned by GET /api/agent?runId=. */
export interface StoredAgentRun {
  runId: string;
  study: string;
  budgetCents: number;
  source: AgentRunResult["source"];
  orderId: string | null;
  steps: AgentStep[];
  recommendation: AgentRunResult["recommendation"] | null;
  createdAt: string;
}
interface AgentRunRow {
  id: string;
  study: string;
  budget_cents: number;
  source: AgentRunResult["source"];
  order_id: string | null;
  steps_json: string;
  recommendation_json: string | null;
  created_at: string;
}
/** Persist one run. Throws if the DB is unavailable (callers decide). */
export async function saveAgentRun(
  input: AgentRunInput,
  run: AgentRunResult,
  url?: string,
): Promise<void> {
  await withDb(async (db) => {
    await ensureTable(db);
    await db
      .prepare(
        `INSERT INTO agent_runs
         (id, study, budget_cents, source, order_id, steps_json, recommendation_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.runId,
        input.study,
        input.budgetCents,
        run.source,
        run.order?.orderId ?? null,
        JSON.stringify(run.steps),
        JSON.stringify(run.recommendation),
      );
  }, url);
}
/** Read one stored run, or undefined if unknown. */
export async function getAgentRun(
  runId: string,
  url?: string,
): Promise<StoredAgentRun | undefined> {
  const row = await withDb(async (db) => {
    await ensureTable(db);
    return (await db
      .prepare(`SELECT * FROM agent_runs WHERE id = ?`)
      .get(runId)) as AgentRunRow | undefined;
  }, url);
  if (!row) return undefined;
  return {
    runId: row.id,
    study: row.study,
    budgetCents: row.budget_cents,
    source: row.source,
    orderId: row.order_id,
    steps: JSON.parse(row.steps_json) as AgentStep[],
    recommendation: row.recommendation_json
      ? (JSON.parse(
          row.recommendation_json,
        ) as StoredAgentRun["recommendation"])
      : null,
    createdAt: row.created_at,
  };
}
