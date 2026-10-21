// Generate a runnable Postman v2.1 collection (and a local environment) from
// openapi/openapi.yaml. Hand-built rather than via openapi-to-postmanv2 so the
// output is deterministic, small, and carries our own test scripts.
//
//   npm run postman:gen
//
// Layout of the collection:
//   1. "Demo: full escrow arc" — match → create order → authorize → deliver →
//      query → billing → capture → payout → order events, chaining datasetId
//      and orderId through pm.collectionVariables. Needs a PAYPAL_MODE=mock
//      server (live mode needs buyer approval between create and authorize).
//   2. One folder per spec tag, one request per operation, with the spec's
//      first example as the body. Happy-path requests assert their status;
//      they run against the state the demo leaves behind ({{orderId}} is a
//      PAID_OUT order, so query and billing succeed).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

type Json = Record<string, unknown>;

interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Parameter[];
  requestBody?: {
    content?: Record<string, { examples?: Record<string, { value: unknown }> }>;
  };
  "x-status"?: string;
}

interface Parameter {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  required?: boolean;
  description?: string;
  schema?: { examples?: unknown[]; enum?: unknown[] };
}

interface Spec {
  info: { title: string; version: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const DEFAULT_BASE_URL = "http://localhost:3000";
const SCHEMA_URL =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

/**
 * Per-operation wiring for the tag folders: which status a successful call
 * returns (adds a test), which collection variable stands in for `orderId`,
 * and which variable to save the created order's id into.
 */
const HAPPY_PATH: Record<
  string,
  { status: number; orderIdVar?: string; saveOrderIdAs?: string }
> = {
  getHealth: { status: 200 },
  getOpenApiSpec: { status: 200 },
  matchDatasets: { status: 200 },
  getOrders: { status: 200 },
  // A fresh order for advanceOrder's example (authorize: MATCHED → AUTHORIZED),
  // so the reference folder never disturbs the demo's {{orderId}}.
  createOrder: { status: 201, saveOrderIdAs: "newOrderId" },
  advanceOrder: { status: 200, orderIdVar: "newOrderId" },
  runQuery: { status: 200 },
  getBilling: { status: 200 },
  recordUsage: { status: 201 },
};

// ---------------------------------------------------------------- builders

interface PostmanRequestInput {
  name: string;
  method: string;
  path: string;
  query?: {
    key: string;
    value: string;
    disabled?: boolean;
    description?: string;
  }[];
  headers?: { key: string; value: string }[];
  body?: unknown;
  description?: string;
  test?: string[];
}

function postmanItem(r: PostmanRequestInput): Json {
  const query = r.query ?? [];
  const enabled = query.filter((q) => !q.disabled);
  const qs = enabled.length
    ? "?" + enabled.map((q) => `${q.key}=${q.value}`).join("&")
    : "";
  const headers = [...(r.headers ?? [])];
  if (r.body !== undefined)
    headers.unshift({ key: "Content-Type", value: "application/json" });

  const request: Json = {
    method: r.method.toUpperCase(),
    header: headers,
    url: {
      raw: `{{baseUrl}}${r.path}${qs}`,
      host: ["{{baseUrl}}"],
      path: r.path.split("/").filter(Boolean),
      ...(query.length ? { query } : {}),
    },
    ...(r.description ? { description: r.description } : {}),
  };
  if (r.body !== undefined) {
    request.body = {
      mode: "raw",
      raw: JSON.stringify(r.body, null, 2),
      options: { raw: { language: "json" } },
    };
  }
  return {
    name: r.name,
    ...(r.test?.length
      ? {
          event: [
            {
              listen: "test",
              script: { type: "text/javascript", exec: r.test },
            },
          ],
        }
      : {}),
    request,
    response: [],
  };
}

const statusTest = (status: number) => [
  `pm.test("status is ${status}", function () {`,
  `  pm.response.to.have.status(${status});`,
  `});`,
];

function firstExample(op: Operation): unknown {
  const examples = op.requestBody?.content?.["application/json"]?.examples;
  return examples ? Object.values(examples)[0]?.value : undefined;
}

/**
 * Point an example body's `orderId` / `datasetId` at collection variables, so
 * reference requests act on the order and dataset the demo set up.
 */
function withIdVars(body: unknown, orderIdVar: string): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const out = { ...(body as Json) };
  if ("orderId" in out) out.orderId = `{{${orderIdVar}}}`;
  if ("datasetId" in out) out.datasetId = "{{datasetId}}";
  return out;
}

function exampleValue(p: Parameter, orderIdVar: string): string {
  if (p.name === "orderId" || p.name === "id") return `{{${orderIdVar}}}`;
  const v = p.schema?.examples?.[0] ?? p.schema?.enum?.[0] ?? "";
  return String(v);
}

function operationItem(path: string, method: string, op: Operation): Json {
  const happy =
    op["x-status"] === "preview" ? undefined : HAPPY_PATH[op.operationId];
  const orderIdVar = happy?.orderIdVar ?? "orderId";
  const params = op.parameters ?? [];
  const body = firstExample(op);

  const test = happy ? statusTest(happy.status) : [];
  if (happy?.saveOrderIdAs) {
    test.push(
      `pm.collectionVariables.set("${happy.saveOrderIdAs}", pm.response.json().orderId);`,
    );
  }

  const preview = op["x-status"] === "preview";
  const description = [
    preview
      ? "**Preview:** documented ahead of its implementation; may 404 on this server."
      : "",
    op.description ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return postmanItem({
    name: op.summary ?? op.operationId,
    method,
    path,
    query: params
      .filter((p) => p.in === "query")
      .map((p) => ({
        key: p.name,
        value: exampleValue(p, orderIdVar),
        // Only required params are on by default; the rest are one click away.
        disabled: !p.required,
        ...(p.description ? { description: p.description } : {}),
      })),
    headers: params
      .filter((p) => p.in === "header")
      .map((p) => ({ key: p.name, value: "" })),
    body: body === undefined ? undefined : withIdVars(body, orderIdVar),
    description,
    test,
  });
}

/** The ordered demo folder: the whole escrow arc on one order. */
function demoFolder(): Json {
  const patch = (action: string, state: string, extra: string[] = []) =>
    postmanItem({
      name: `${action[0].toUpperCase()}${action.slice(1)} (→ ${state})`,
      method: "patch",
      path: "/api/orders",
      body: { orderId: "{{orderId}}", action },
      test: [
        ...statusTest(200),
        `pm.test("escrow is ${state}", function () {`,
        `  pm.expect(pm.response.json().escrowState).to.eql("${state}");`,
        `});`,
        ...extra,
      ],
    });

  return {
    name: "Demo: full escrow arc",
    description:
      "Run in order against a `PAYPAL_MODE=mock` server (`npm run dev:mock`). " +
      "Matches a study, escrows the top dataset at its listed price, walks " +
      "authorize → deliver → query → billing → capture → payout, and reads " +
      "the audit trail. datasetId and orderId chain through collection variables.",
    item: [
      postmanItem({
        name: "1. Match a study to datasets",
        method: "post",
        path: "/api/match",
        body: {
          description: "Heart disease cohort with cardiology encounters",
        },
        test: [
          ...statusTest(200),
          `const matches = pm.response.json().matches;`,
          `pm.test("returns at least one match", function () {`,
          `  pm.expect(matches.length).to.be.above(0);`,
          `});`,
          `pm.collectionVariables.set("datasetId", matches[0].datasetId);`,
        ],
      }),
      postmanItem({
        name: "2. Create escrow order (→ MATCHED)",
        method: "post",
        path: "/api/orders",
        body: {
          datasetId: "{{datasetId}}",
          buyerEmail: "researcher@example.edu",
        },
        test: [
          ...statusTest(201),
          `const body = pm.response.json();`,
          `pm.test("order starts MATCHED", function () {`,
          `  pm.expect(body.escrowState).to.eql("MATCHED");`,
          `});`,
          `pm.collectionVariables.set("orderId", body.orderId);`,
        ],
      }),
      patch("authorize", "AUTHORIZED", [
        `pm.test("returns an authorizationId", function () {`,
        `  pm.expect(pm.response.json().authorizationId).to.be.a("string");`,
        `});`,
      ]),
      patch("deliver", "DELIVERED"),
      postmanItem({
        name: "5. Query the dataset (privacy-safe aggregate)",
        method: "post",
        path: "/api/query",
        body: {
          orderId: "{{orderId}}",
          datasetId: "{{datasetId}}",
          question: "average age by sex",
        },
        test: [
          ...statusTest(200),
          `const body = pm.response.json();`,
          `pm.test("returns aggregate rows and bills the query", function () {`,
          `  pm.expect(body.result.length).to.be.above(0);`,
          `  pm.expect(body.usage.chargeCents).to.eql(50);`,
          `});`,
        ],
      }),
      postmanItem({
        name: "6. Billing: per-query spend",
        method: "get",
        path: "/api/billing",
        query: [{ key: "orderId", value: "{{orderId}}" }],
        test: [
          ...statusTest(200),
          `pm.test("the answered query was metered", function () {`,
          `  const body = pm.response.json();`,
          `  pm.expect(body.queryCount).to.eql(1);`,
          `  pm.expect(body.totalCents).to.eql(50);`,
          `});`,
        ],
      }),
      patch("capture", "CAPTURED"),
      patch("payout", "PAID_OUT"),
      postmanItem({
        name: "9. Order with audit events",
        method: "get",
        path: "/api/orders",
        query: [
          { key: "id", value: "{{orderId}}" },
          { key: "events", value: "1" },
        ],
        test: [
          ...statusTest(200),
          `const body = pm.response.json();`,
          `pm.test("order is PAID_OUT with the full timeline", function () {`,
          `  pm.expect(body.order.status).to.eql("PAID_OUT");`,
          `  pm.expect(body.events.map(function (e) { return e.event; })).to.eql(`,
          `    ["CREATE", "AUTHORIZE", "DELIVER", "CAPTURE", "PAYOUT"]`,
          `  );`,
          `});`,
        ],
      }),
    ].map((item, i) =>
      // Number the PATCH steps (3, 4, 7, 8) to match the others.
      /^\d+\./.test(String(item.name))
        ? item
        : { ...item, name: `${i + 1}. ${String(item.name)}` },
    ),
  };
}

export function buildCollection(spec: Spec): Json {
  const tagNames = (spec.tags ?? []).map((t) => t.name);
  const folders = new Map<string, Json[]>(tagNames.map((t) => [t, []]));
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "Other";
      if (!folders.has(tag)) folders.set(tag, []);
      folders.get(tag)!.push(operationItem(path, method, op));
    }
  }
  const tagDescription = new Map(
    (spec.tags ?? []).map((t) => [t.name, t.description]),
  );

  return {
    info: {
      name: spec.info.title,
      description:
        `Generated from openapi/openapi.yaml (v${spec.info.version}) by ` +
        "`npm run postman:gen`. Do not edit by hand.\n\n" +
        (spec.info.description ?? ""),
      schema: SCHEMA_URL,
    },
    item: [
      demoFolder(),
      ...[...folders]
        .filter(([, items]) => items.length > 0)
        .map(([name, items]) => ({
          name,
          ...(tagDescription.get(name)
            ? { description: tagDescription.get(name) }
            : {}),
          item: items,
        })),
    ],
    variable: [
      { key: "baseUrl", value: DEFAULT_BASE_URL },
      { key: "datasetId", value: "ds_cardio_synthea_v1" },
      { key: "orderId", value: "" },
      { key: "newOrderId", value: "" },
    ],
  };
}

export function buildEnvironment(): Json {
  return {
    name: "meddata-escrow (local)",
    values: [
      {
        key: "baseUrl",
        value: DEFAULT_BASE_URL,
        type: "default",
        enabled: true,
      },
    ],
    _postman_variable_scope: "environment",
  };
}

export function loadSpec(root = process.cwd()): Spec {
  return parse(
    readFileSync(join(root, "openapi", "openapi.yaml"), "utf8"),
  ) as Spec;
}

export const COLLECTION_PATH = join(
  "postman",
  "meddata-escrow.postman_collection.json",
);
export const ENVIRONMENT_PATH = join(
  "postman",
  "meddata-escrow.postman_environment.json",
);

function main() {
  const write = (path: string, data: Json) =>
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  write(COLLECTION_PATH, buildCollection(loadSpec()));
  write(ENVIRONMENT_PATH, buildEnvironment());
  console.log(`wrote ${COLLECTION_PATH} and ${ENVIRONMENT_PATH}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
