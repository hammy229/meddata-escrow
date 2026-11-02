import { Client, type ClientConfig } from "pg";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { postgresConfig } from "../postgres/config";
import type { QueryPlan } from "../ai/nl2query";
import {
  QueryPlan as Plan,
  GROUP_FIELDS,
  NUMERIC_FIELDS,
} from "../ai/nl2query";
import { MIN_CELL_SIZE } from "../ai/privacy-guard";
import type { AggregateRow } from "../query/mock-execute";

export interface SourceCredentials {
  connectionString: string;
  caCert?: string;
  schemaName: string;
  tableName: string;
}
export function identifier(value: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value))
    throw new Error(
      "Schema and view names must use lowercase letters, digits, and underscores",
    );
  return `"${value}"`;
}
const forbidden = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  forbidden.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  forbidden.addSubnet(address, prefix, "ipv6");
const privateRanges = new BlockList();
for (const [address, prefix] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
] as const)
  privateRanges.addSubnet(address, prefix, "ipv4");
privateRanges.addSubnet("fc00::", 7, "ipv6");
export function addressAllowed(
  address: string,
  allowLocal = false,
  allowPrivate = false,
): boolean {
  const family = isIP(address) === 6 ? "ipv6" : "ipv4";
  if (!isIP(address)) return false;
  const local = address === "127.0.0.1" || address === "::1";
  if (local && allowLocal) return true;
  return (
    !forbidden.check(address, family) &&
    (allowPrivate || !privateRanges.check(address, family))
  );
}
export async function sourceConfig(
  credentials: SourceCredentials,
): Promise<ClientConfig> {
  identifier(credentials.schemaName);
  identifier(credentials.tableName);
  const url = new URL(credentials.connectionString),
    host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const allowed = (process.env.PROVIDER_DATABASE_HOSTS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.includes(host))
    throw new Error(
      "This database host must be added to PROVIDER_DATABASE_HOSTS by the app operator",
    );
  const allowLocal =
    process.env.NODE_ENV !== "production" &&
    process.env.PROVIDER_DATABASE_ALLOW_LOCAL === "true";
  const config = postgresConfig(credentials.connectionString, {
    allowLocal,
    ca: credentials.caCert,
  });
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true });
  if (
    !addresses.length ||
    addresses.some(
      (a) =>
        !addressAllowed(
          a.address,
          allowLocal,
          process.env.PROVIDER_DATABASE_ALLOW_PRIVATE === "true",
        ),
    )
  )
    throw new Error("This database address is not permitted");
  // Pin the resolved address to prevent DNS rebinding, preserving TLS hostname verification.
  return {
    ...config,
    host: addresses[0].address,
    ssl:
      config.ssl && typeof config.ssl === "object"
        ? { ...config.ssl, servername: host }
        : config.ssl,
  };
}
export interface SourceClient {
  connect(): Promise<unknown>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<unknown>;
}
export type SourceFactory = (config: ClientConfig) => SourceClient;
const defaultFactory: SourceFactory = (config) =>
  new Client(config) as SourceClient;
export async function withSource<T>(
  credentials: SourceCredentials,
  fn: (client: SourceClient) => Promise<T>,
  factory = defaultFactory,
): Promise<T> {
  const client = factory(await sourceConfig(credentials));
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '8s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL search_path = pg_catalog");
    const value = await fn(client);
    await client.query("ROLLBACK");
    return value;
  } finally {
    await client.end().catch(() => {});
  }
}
export async function inspectSource(
  credentials: SourceCredentials,
  factory?: SourceFactory,
) {
  return withSource(
    credentials,
    async (client) => {
      const privilege = await client.query(
        "SELECT rolsuper, rolbypassrls FROM pg_catalog.pg_roles WHERE rolname = current_user",
      );
      if (
        !privilege.rows.length ||
        privilege.rows[0].rolsuper ||
        privilege.rows[0].rolbypassrls
      )
        throw new Error(
          "Use a dedicated database login without superuser or BYPASSRLS privileges",
        );
      const permissions = await client.query(
        "SELECT has_table_privilege(current_user, $1, 'SELECT') AS can_read, has_table_privilege(current_user, $1, 'INSERT,UPDATE,DELETE,TRUNCATE') AS can_write",
        [
          `${identifier(credentials.schemaName)}.${identifier(credentials.tableName)}`,
        ],
      );
      if (!permissions.rows[0]?.can_read || permissions.rows[0]?.can_write)
        throw new Error(
          "Use a database login with SELECT-only access to the research view",
        );
      const columns = await client.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [credentials.schemaName, credentials.tableName],
      );
      const names = columns.rows.map((c) => String(c.column_name));
      if (!names.includes("dataset_id"))
        throw new Error("The research view must include a dataset_id column");
      const allowed = new Set<string>([
        "dataset_id",
        ...GROUP_FIELDS,
        ...NUMERIC_FIELDS,
      ]);
      if (names.some((c) => !allowed.has(c)))
        throw new Error(
          "Expose only dataset_id and supported research fields through a dedicated view",
        );
      await client.query(
        `SELECT COUNT(*)::integer AS count FROM ${identifier(credentials.schemaName)}.${identifier(credentials.tableName)} WHERE false`,
      );
      return { fields: names.filter((n) => n !== "dataset_id") };
    },
    factory,
  );
}
export function aggregateSql(credentials: SourceCredentials, raw: QueryPlan) {
  const plan = Plan.parse(raw);
  const relation = `${identifier(credentials.schemaName)}.${identifier(credentials.tableName)}`;
  const group = plan.groupBy ? identifier(plan.groupBy) : null;
  const aggregate =
    plan.op === "count"
      ? "COUNT(*)"
      : `${plan.op.toUpperCase()}(${identifier(plan.field ?? "value")})`;
  const alias =
    plan.op === "count" ? "count" : `${plan.op}_${plan.field ?? "value"}`;
  // Only the bounded plan is compiled; no caller-provided SQL reaches PostgreSQL.
  return {
    sql: `SELECT ${group ? `${group} AS "group", ` : ""}${aggregate} AS "${alias}", COUNT(*) AS "_cell_count" FROM ${relation} WHERE dataset_id = $1${group ? ` GROUP BY ${group}` : ""} HAVING COUNT(*) >= ${MIN_CELL_SIZE} LIMIT 201`,
    alias,
  };
}
export async function executeSource(
  credentials: SourceCredentials,
  datasetKey: string,
  plan: QueryPlan,
  factory?: SourceFactory,
): Promise<AggregateRow[]> {
  return withSource(
    credentials,
    async (client) => {
      const { sql } = aggregateSql(credentials, plan);
      const { rows } = await client.query(sql, [datasetKey]);
      if (rows.length > 200)
        throw new Error(
          "Too many result groups. Use a coarser research grouping",
        );
      return rows.map((row) => {
        const { _cell_count, ...values } = row;
        if (Number(_cell_count) < MIN_CELL_SIZE)
          throw new Error("Result suppressed");
        const result: AggregateRow = {};
        for (const [key, value] of Object.entries(values)) {
          if (key === "group") {
            if (typeof value !== "string" && typeof value !== "number")
              throw new Error("Invalid research grouping");
            if (String(value).length > 100)
              throw new Error("Research group label is too long");
            result[key] = value;
          } else {
            if (value === null || !Number.isFinite(Number(value)))
              throw new Error("No usable aggregate result for this field");
            result[key] = Number(value);
          }
        }
        return result;
      });
    },
    factory,
  );
}
