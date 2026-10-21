// GET /api/openapi — the OpenAPI 3.1 spec (openapi/openapi.yaml), so Postman,
// APIMatic and other tooling can import it straight from a running server.
//
//   GET /api/openapi              -> 200 application/json (the parsed spec)
//   GET /api/openapi?format=yaml  -> 200 application/yaml (the file verbatim)
//
// The file is read with a URL relative to this module (same pattern as
// /api/match's catalog), which Next traces into the server bundle.
import { readFileSync } from "node:fs";
import { parse } from "yaml";

const SPEC_URL = new URL("../../../openapi/openapi.yaml", import.meta.url);

// Reads the query string, so it is request-time anyway; stated explicitly.
export const dynamic = "force-dynamic";

let cached: { yaml: string; json: unknown } | undefined;

function loadSpec() {
  if (!cached) {
    const yaml = readFileSync(SPEC_URL, "utf8");
    cached = { yaml, json: parse(yaml) };
  }
  return cached;
}

export async function GET(request: Request) {
  const spec = loadSpec();
  const format = new URL(request.url).searchParams.get("format");
  if (format === "yaml") {
    return new Response(spec.yaml, {
      headers: { "content-type": "application/yaml; charset=utf-8" },
    });
  }
  return Response.json(spec.json);
}
