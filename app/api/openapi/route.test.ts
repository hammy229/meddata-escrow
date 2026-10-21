// /api/openapi spec — serves openapi/openapi.yaml as JSON, or verbatim YAML
// with ?format=yaml.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GET } from "./route";

const req = (qs = "") => new Request(`http://localhost/api/openapi${qs}`);

test("GET returns the spec as JSON", async () => {
  const res = await GET(req());
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const spec = await res.json();
  assert.match(spec.openapi, /^3\.1\./);
  assert.equal(spec.info.title, "MedData Escrow API");
  assert.ok(spec.paths["/api/orders"].patch, "documents PATCH /api/orders");
  assert.ok(spec.paths["/api/openapi"].get, "documents itself");
});

test("GET ?format=yaml returns the file verbatim", async () => {
  const res = await GET(req("?format=yaml"));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/yaml/);
  const onDisk = readFileSync(
    join(process.cwd(), "openapi", "openapi.yaml"),
    "utf8",
  );
  assert.equal(await res.text(), onDisk);
});
