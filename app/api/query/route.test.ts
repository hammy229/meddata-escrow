// /api/query spec — fully local (nl2query + privacy-guard + mock executor, no
// network, no dataset). Calls the exported POST with a Web Request.
import { test } from "node:test";
import assert from "node:assert/strict";

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/query", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("happy path returns a privacy-safe aggregate (200)", async () => {
  // checkQuery gates the raw question: it must read as an aggregate ask (carry
  // an aggregate marker) and contain no row-level / PII phrasing.
  const res = await POST(
    req({
      datasetId: "ds_cardio_synthea_v1",
      question: "count(*) of patients by sex",
    }),
  );
  assert.equal(res.status, 200);

  const json = await res.json();
  assert.equal(json.datasetId, "ds_cardio_synthea_v1");
  assert.ok(json.compiled.sql.includes("GROUP BY"));
  assert.ok(Array.isArray(json.result));
  assert.ok(json.result.length >= 1);
  // Every returned cell is at or above the suppression threshold (11).
  for (const row of json.result) {
    assert.ok(row.count >= 11);
  }
});

test("row-level / SELECT * question is rejected (403)", async () => {
  const res = await POST(
    req({ datasetId: "ds_x", question: "select * from patients" }),
  );
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, "query rejected");
  assert.ok(Array.isArray(json.reasons) && json.reasons.length > 0);
});

test("missing fields -> 422", async () => {
  const res = await POST(req({ datasetId: "ds_x" }));
  assert.equal(res.status, 422);
});
