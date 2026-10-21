// The committed Postman collection must match what the generator produces from
// the current spec, so a spec edit without `npm run postman:gen` fails CI.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildCollection,
  buildEnvironment,
  loadSpec,
  COLLECTION_PATH,
  ENVIRONMENT_PATH,
} from "./to-postman";

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("committed collection is up to date with openapi.yaml", () => {
  assert.deepEqual(
    readJson(COLLECTION_PATH),
    buildCollection(loadSpec()),
    "run `npm run postman:gen` and commit the result",
  );
});

test("committed environment is up to date", () => {
  assert.deepEqual(readJson(ENVIRONMENT_PATH), buildEnvironment());
});

test("collection has the demo folder first, then one folder per used tag", () => {
  const collection = buildCollection(loadSpec()) as {
    item: { name: string; item: { name: string }[] }[];
  };
  const names = collection.item.map((f) => f.name);
  assert.equal(names[0], "Demo: full escrow arc");
  assert.ok(names.includes("Orders") && names.includes("Query"));
  assert.equal(collection.item[0].item.length, 9);
});

test("every spec operation becomes exactly one request", () => {
  const spec = loadSpec();
  const ops = Object.values(spec.paths).flatMap((item) =>
    Object.keys(item).filter((m) =>
      ["get", "post", "put", "patch", "delete"].includes(m),
    ),
  );
  const collection = buildCollection(spec) as {
    item: { item: unknown[] }[];
  };
  const requests = collection.item.slice(1).flatMap((f) => f.item);
  assert.equal(requests.length, ops.length);
});
