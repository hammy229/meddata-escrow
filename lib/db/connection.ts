import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient, type QueryResult } from "pg";
import { openDb } from "./client";
import type { DatabaseSync } from "node:sqlite";
import { postgresConfig, postgresSql } from "../postgres/config";

export type Value = string | number | bigint | boolean | null | Uint8Array;
export interface AppDatabase {
  dialect: "sqlite" | "postgres";
  prepare(sql: string): {
    get(...params: Value[]): Promise<unknown>;
    all(...params: Value[]): Promise<unknown[]>;
    run(...params: Value[]): Promise<{ changes: number }>;
  };
  exec(sql: string): Promise<void>;
}
export function sqliteConnection(db: DatabaseSync): AppDatabase {
  const values = (params: Value[]) =>
    params.map((p) => (typeof p === "boolean" ? Number(p) : p));
  return {
    dialect: "sqlite",
    prepare: (sql) => ({
      get: async (...params) => db.prepare(sql).get(...values(params)),
      all: async (...params) => db.prepare(sql).all(...values(params)),
      run: async (...params) => ({
        changes: Number(db.prepare(sql).run(...values(params)).changes),
      }),
    }),
    exec: async (sql) => {
      db.exec(sql === "BEGIN" ? "BEGIN IMMEDIATE" : sql);
    },
  };
}
export interface PostgresQueryable {
  query(
    sql: string,
    params?: unknown[],
  ): Promise<Pick<QueryResult, "rows" | "rowCount">>;
}
export function postgresConnection(client: PostgresQueryable): AppDatabase {
  return {
    dialect: "postgres",
    prepare: (sql) => {
      const query = (...params: Value[]) =>
        client.query(postgresSql(sql), params);
      return {
        get: async (...params) => (await query(...params)).rows[0],
        all: async (...params) => (await query(...params)).rows,
        run: async (...params) => ({
          changes: (await query(...params)).rowCount ?? 0,
        }),
      };
    },
    exec: async (sql) => {
      await client.query(sql === "BEGIN IMMEDIATE" ? "BEGIN" : sql);
    },
  };
}
let pool: Pool | undefined;
let configuredUrl: string | undefined;
export const databaseScope = new AsyncLocalStorage<string>();
export function appDatabaseUrl(): string | undefined {
  return (
    databaseScope.getStore() ??
    (process.env.APP_DATABASE_URL || process.env.DATABASE_URL)
  );
}
export function isPostgres(url = appDatabaseUrl()): boolean {
  return !!url && /^postgres(?:ql)?:\/\//.test(url);
}
function getPool(url: string): Pool {
  if (pool && url !== configuredUrl)
    throw new Error("Database configuration changed; restart the application");
  if (!pool) {
    pool = new Pool({
      ...postgresConfig(url, {
        allowLocal: process.env.NODE_ENV !== "production",
        ca: process.env.APP_DATABASE_CA_CERT,
        allowSelfSigned: process.env.APP_DATABASE_TLS_MODE === "require",
      }),
      max: 10,
      idleTimeoutMillis: 30000,
    });
    pool.on("error", () =>
      console.error("App PostgreSQL pool connection error"),
    );
    configuredUrl = url;
  }
  return pool;
}
export async function closeAppDatabase(): Promise<void> {
  if (pool) await pool.end();
  pool = undefined;
  configuredUrl = undefined;
}
const sqliteQueues = new Map<string, Promise<unknown>>();
export async function withDb<T>(
  fn: (db: AppDatabase) => T | Promise<T>,
  explicitUrl?: string,
): Promise<T> {
  const url = explicitUrl ?? appDatabaseUrl();
  if (isPostgres(url)) {
    const client: PoolClient = await getPool(url!).connect();
    try {
      return await fn(postgresConnection(client));
    } finally {
      client.release();
    }
  }
  const key = url ?? "default";
  const previous = sqliteQueues.get(key) ?? Promise.resolve();
  const work = previous
    .catch(() => {})
    .then(async () => {
      const db = openDb(url);
      try {
        return await fn(sqliteConnection(db));
      } finally {
        db.close();
      }
    });
  sqliteQueues.set(key, work);
  try {
    return await work;
  } finally {
    if (sqliteQueues.get(key) === work) sqliteQueues.delete(key);
  }
}
const activeTransactions = new WeakSet<AppDatabase>();
export async function transaction<T>(
  db: AppDatabase,
  fn: () => Promise<T>,
): Promise<T> {
  if (activeTransactions.has(db)) return fn();
  await db.exec("BEGIN");
  activeTransactions.add(db);
  try {
    const value = await fn();
    await db.exec("COMMIT");
    return value;
  } catch (err) {
    await db.exec("ROLLBACK");
    throw err;
  } finally {
    activeTransactions.delete(db);
  }
}
