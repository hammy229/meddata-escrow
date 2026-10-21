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
  // Plain English is enough: the question is screened for intent, and the
  // compiled SQL (not the question) must carry the aggregate.
  const res = await POST(
    req({
      datasetId: "ds_cardio_synthea_v1",
      question: "How many patients by sex?",
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

test("plain-English average question returns 200", async () => {
  const res = await POST(
    req({ datasetId: "ds_x", question: "average age by region" }),
  );
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.match(json.compiled.sql, /AVG\(age\)/);
});

test("PII question is rejected (403)", async () => {
  const res = await POST(
    req({ datasetId: "ds_x", question: "How many patients by zip code?" }),
  );
  assert.equal(res.status, 403);
  const json = await res.json();
  assert.equal(json.error, "query rejected");
  assert.ok(json.reasons.some((r: string) => /zip/.test(r)));
});

test("row-level plain-English question is rejected (403)", async () => {
  const res = await POST(
    req({ datasetId: "ds_x", question: "List all patients in the cohort" }),
  );
  assert.equal(res.status, 403);
});

test("missing fields -> 422", async () => {
  const res = await POST(req({ datasetId: "ds_x" }));
  assert.equal(res.status, 422);
});
