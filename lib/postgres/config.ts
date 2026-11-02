import type { ClientConfig } from "pg";

export function postgresConfig(
  connectionString: string,
  options: {
    allowLocal?: boolean;
    ca?: string;
    allowSelfSigned?: boolean;
  } = {},
): ClientConfig {
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.pathname.slice(1)
  )
    throw new Error(
      "Use a PostgreSQL connection URL with a host and database name",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // Parse the URL ourselves so URL parameters cannot override TLS or timeouts.
  const insecure = url.searchParams.get("sslmode") === "disable";
  if (insecure && !(local && options.allowLocal))
    throw new Error("TLS is required for remote PostgreSQL connections");
  return {
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: insecure
      ? false
      : {
          rejectUnauthorized: !options.allowSelfSigned,
          ...(options.ca ? { ca: options.ca } : {}),
        },
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 8000,
    application_name: "meddata-escrow",
    options: "-c timezone=UTC",
  };
}
// SQL written by our repository uses SQLite-style parameters. Do not replace
// question marks within quoted strings, identifiers, or SQL comments.
export function postgresSql(sql: string): string {
  let count = 0;
  return sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (token) => (token === "?" ? `$${++count}` : token),
  );
}
