import { randomUUID } from "node:crypto";
import { z } from "zod";
import { withDb, transaction } from "../db/connection";
import { encryptSecret, decryptSecret } from "./secrets";
import {
  identifier,
  inspectSource,
  executeSource,
  aggregateSql,
  type SourceCredentials,
  type SourceFactory,
} from "./postgres";
import type { QueryPlan } from "../ai/nl2query";
import type { Account } from "../auth/store";

export const ConnectionInput = z.object({
  label: z.string().trim().min(2).max(100),
  connectionString: z.string().trim().min(10).max(4096),
  caCert: z.string().max(20000).optional(),
  schemaName: z.string().default("public"),
  tableName: z.string().default("research_records"),
});
interface SourceRow {
  id: string;
  vendor_id: string;
  label: string;
  host: string;
  database_name: string;
  encrypted_config: string;
  schema_name: string;
  table_name: string;
  fields_json: string;
  tested_at: string;
}
export function publicSource(row: SourceRow) {
  return {
    id: row.id,
    label: row.label,
    host: row.host,
    databaseName: row.database_name,
    schemaName: row.schema_name,
    tableName: row.table_name,
    fields: JSON.parse(row.fields_json) as string[],
    testedAt: row.tested_at,
  };
}
export async function listConnections(account: Account) {
  return withDb(async (db) =>
    (
      (await db
        .prepare(
          "SELECT * FROM provider_connections WHERE vendor_id = ? ORDER BY created_at DESC, id DESC",
        )
        .all(account.vendor_id)) as SourceRow[]
    ).map(publicSource),
  );
}
export async function saveConnection(
  account: Account,
  raw: unknown,
  factory?: SourceFactory,
) {
  const input = ConnectionInput.parse(raw),
    id = `src_${randomUUID()}`;
  identifier(input.schemaName);
  identifier(input.tableName);
  const encrypted = encryptSecret(
    JSON.stringify(input),
    `${account.vendor_id}:${id}`,
  );
  const { fields } = await inspectSource(input, factory);
  const url = new URL(input.connectionString);
  await withDb((db) =>
    db
      .prepare(
        "INSERT INTO provider_connections (id, vendor_id, label, host, database_name, schema_name, table_name, encrypted_config, fields_json, tested_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        account.vendor_id,
        input.label,
        url.hostname,
        decodeURIComponent(url.pathname.slice(1)),
        input.schemaName,
        input.tableName,
        encrypted,
        JSON.stringify(fields),
        new Date().toISOString(),
      ),
  );
  return id;
}
export async function getConnection(id: string, vendorId: string) {
  const row = (await withDb((db) =>
    db
      .prepare(
        "SELECT * FROM provider_connections WHERE id = ? AND vendor_id = ?",
      )
      .get(id, vendorId),
  )) as SourceRow | undefined;
  if (!row) throw new Error("Connection not found");
  const config = JSON.parse(
    decryptSecret(row.encrypted_config, `${vendorId}:${id}`),
  ) as SourceCredentials;
  return { row, config };
}
export async function testConnection(
  account: Account,
  id: string,
  factory?: SourceFactory,
) {
  const { config } = await getConnection(id, account.vendor_id!);
  const result = await inspectSource(config, factory);
  await withDb((db) =>
    db
      .prepare(
        "UPDATE provider_connections SET tested_at = ?, fields_json = ? WHERE id = ? AND vendor_id = ?",
      )
      .run(
        new Date().toISOString(),
        JSON.stringify(result.fields),
        id,
        account.vendor_id,
      ),
  );
  return result;
}
export async function deleteConnection(account: Account, id: string) {
  return withDb((db) =>
    transaction(db, async () => {
      const linked = await db
        .prepare(
          "SELECT 1 FROM datasets WHERE source_connection_id = ? AND vendor_id = ?",
        )
        .get(id, account.vendor_id);
      if (linked)
        throw new Error(
          "This connection is used by a dataset. Keep it available for existing purchases",
        );
      const result = await db
        .prepare(
          "DELETE FROM provider_connections WHERE id = ? AND vendor_id = ?",
        )
        .run(id, account.vendor_id);
      if (!result.changes) throw new Error("Connection not found");
    }),
  );
}
export const ListingInput = z.object({
  connectionId: z.string().min(1),
  datasetKey: z.string().trim().min(1).max(200),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(2000),
  priceCents: z.number().int().min(100).max(1000000),
  synthetic: z.literal(true),
});
export async function publishDataset(
  account: Account,
  raw: unknown,
  factory?: SourceFactory,
) {
  const input = ListingInput.parse(raw);
  const { config } = await getConnection(
    input.connectionId,
    account.vendor_id!,
  );
  await inspectSource(config, factory);
  const rows = await executeSource(
    config,
    input.datasetKey,
    { op: "count", field: null, groupBy: null },
    factory,
  );
  if (!rows.length)
    throw new Error(
      "Dataset not found or too small to publish (minimum 11 records)",
    );
  const id = `ds_${randomUUID()}`;
  await withDb((db) =>
    db
      .prepare(
        "INSERT INTO datasets (id, vendor_id, title, description, price_cents, source_connection_id, source_dataset_key, record_count, tags_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        account.vendor_id,
        input.title,
        input.description,
        input.priceCents,
        input.connectionId,
        input.datasetKey,
        Number(rows[0].count),
        JSON.stringify(["synthetic", "postgresql"]),
      ),
  );
  return id;
}
export async function datasetSource(datasetId: string) {
  const row = (await withDb((db) =>
    db
      .prepare(
        "SELECT vendor_id, source_connection_id, source_dataset_key FROM datasets WHERE id = ?",
      )
      .get(datasetId),
  )) as
    | {
        vendor_id: string;
        source_connection_id: string | null;
        source_dataset_key: string | null;
      }
    | undefined;
  if (!row?.source_connection_id) return null;
  const { config } = await getConnection(
    row.source_connection_id,
    row.vendor_id,
  );
  return { config, datasetKey: row.source_dataset_key! };
}
export async function executeDataset(datasetId: string, plan: QueryPlan) {
  const source = await datasetSource(datasetId);
  if (!source) return null;
  return {
    rows: await executeSource(source.config, source.datasetKey, plan),
    sql: aggregateSql(source.config, plan).sql,
  };
}
