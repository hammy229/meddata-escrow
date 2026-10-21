// Drift guard for openapi/openapi.yaml. Every app/api/**/route.ts handler must
// be documented under its path, and every documented operation must either
// have a handler on this branch or be marked `x-status: preview`. Also checks
// the spec is OpenAPI 3.1, operationIds are unique camelCase (APIMatic turns
// them into SDK method names), and every local $ref resolves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse } from "yaml";

const ROOT = process.cwd();
const SPEC_PATH = join(ROOT, "openapi", "openapi.yaml");
const API_DIR = join(ROOT, "app", "api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

type Json = Record<string, unknown>;
const spec = parse(readFileSync(SPEC_PATH, "utf8")) as Json;
const paths = spec.paths as Record<string, Record<string, Json>>;

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return routeFiles(full);
    return e.name === "route.ts" ? [full] : [];
  });
}

/** app/api/orders/[id]/route.ts -> /api/orders/{id} */
function routePath(file: string): string {
  const dir = relative(join(ROOT, "app"), file).split(sep).slice(0, -1);
  return "/" + dir.map((s) => s.replace(/^\[(.+)\]$/, "{$1}")).join("/");
}

/** HTTP methods a route file exports (function or const form). */
function exportedMethods(file: string): string[] {
  const src = readFileSync(file, "utf8");
  return METHODS.filter((m) =>
    new RegExp(
      `export\\s+(?:async\\s+)?(?:function\\s+${m}\\b|const\\s+${m}\\b)`,
    ).test(src),
  );
}

const implemented = new Map(
  routeFiles(API_DIR).map((f) => [routePath(f), exportedMethods(f)]),
);

function isPreview(path: string, method: string): boolean {
  const item = paths[path] as Json;
  return (
    item["x-status"] === "preview" ||
    (item[method] as Json | undefined)?.["x-status"] === "preview"
  );
}

test("spec is OpenAPI 3.1 with info and paths", () => {
  assert.match(String(spec.openapi), /^3\.1\.\d+$/);
  const info = spec.info as Json;
  assert.ok(info.title && info.version, "info.title and info.version");
  assert.ok(paths && Object.keys(paths).length > 0, "paths present");
});

test("found route files to check", () => {
  assert.ok(implemented.size > 0, "no app/api/**/route.ts found");
});

test("every exported route handler is documented under its path", () => {
  for (const [path, methods] of implemented) {
    assert.ok(paths[path], `${path} is missing from openapi.yaml`);
    for (const m of methods) {
      assert.ok(
        paths[path][m.toLowerCase()],
        `${m} ${path} is exported by the route but missing from openapi.yaml`,
      );
    }
  }
});

test("every documented operation is implemented or marked x-status: preview", () => {
  for (const [path, item] of Object.entries(paths)) {
    for (const m of Object.keys(item)) {
      if (!METHODS.includes(m.toUpperCase())) continue;
      const exported = implemented.get(path)?.includes(m.toUpperCase());
      assert.ok(
        exported || isPreview(path, m),
        `${m.toUpperCase()} ${path} has no route handler; implement it or mark it x-status: preview`,
      );
    }
  }
});

test("operationIds are present, unique and camelCase", () => {
  const seen = new Set<string>();
  for (const [path, item] of Object.entries(paths)) {
    for (const [m, op] of Object.entries(item)) {
      if (!METHODS.includes(m.toUpperCase())) continue;
      const id = op.operationId;
      assert.equal(typeof id, "string", `${m} ${path} has no operationId`);
      assert.match(id as string, /^[a-z][a-zA-Z0-9]*$/, `${id} not camelCase`);
      assert.ok(!seen.has(id as string), `duplicate operationId ${id}`);
      seen.add(id as string);
    }
  }
});

test("every $ref resolves", () => {
  const refs: string[] = [];
  (function walk(node: unknown) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "$ref" && typeof v === "string") refs.push(v);
        else walk(v);
      }
    }
  })(spec);
  assert.ok(refs.length > 0, "expected some $refs");
  for (const ref of refs) {
    assert.ok(ref.startsWith("#/"), `only local refs are supported: ${ref}`);
    let target: unknown = spec;
    for (const raw of ref.slice(2).split("/")) {
      const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
      target = (target as Json | undefined)?.[key];
    }
    assert.ok(target !== undefined, `unresolved $ref: ${ref}`);
  }
});
