import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkQuery,
  checkQuestion,
  checkResult,
  MIN_CELL_SIZE,
  reviewQuestion,
} from "./privacy-guard";
import { failingLlm, fakeLlm, promptOf } from "./testing";

// --- Claude second-opinion screen (fake client, no network) ---

test("a Claude denial blocks a question the rules allow and adds its reason", async () => {
  const { client, calls } = fakeLlm({
    allowed: false,
    reason:
      "Rare diagnosis plus one small town plus exact age isolates a person.",
  });
  const q = "average cost for 47-year-olds with diagnosis Q87.4 in region west";
  const v = await checkQuestion(q, "ds_x", { client, useLlm: true });
  assert.equal(v.allowed, false);
  assert.equal(calls.length, 1);
  assert.match(promptOf(calls[0]), /Q87\.4/);
  assert.ok(v.reasons.some((r) => /Privacy review: .*isolates/.test(r)));
});

test("a Claude allow cannot unblock a rule denial", async () => {
  const { client, calls } = fakeLlm({ allowed: true, reason: "Looks fine." });
  const v = await checkQuestion("What are the patient names?", "ds_x", {
    client,
    useLlm: true,
  });
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /PII/.test(r)));
  // Deterministic denials are final, so the model isn't even consulted.
  assert.equal(calls.length, 0);
});

test("a Claude allow keeps an allowed question allowed", async () => {
  const { client } = fakeLlm({ allowed: true, reason: "Cohort aggregate." });
  const v = await checkQuestion("How many patients by sex?", "ds_x", {
    client,
    useLlm: true,
  });
  assert.deepEqual(v, { allowed: true, reasons: [] });
});

test("a Claude error leaves the deterministic verdict in place", async () => {
  const { client, calls } = failingLlm();
  const v = await checkQuestion("average age by region", "ds_x", {
    client,
    useLlm: true,
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(v, { allowed: true, reasons: [] });
});

test("with the LLM disabled checkQuestion never calls it", async () => {
  const { client, calls } = fakeLlm({ allowed: false, reason: "no" });
  const v = await checkQuestion("How many patients by sex?", "ds_x", {
    client,
    useLlm: false,
  });
  assert.equal(calls.length, 0);
  assert.equal(v.allowed, true);
});

test("reviewQuestion rejects a malformed review (so callers fall back)", async () => {
  const { client } = fakeLlm({ allowed: "maybe" });
  await assert.rejects(reviewQuestion("how many patients?", { client }));
});

test("allows a plain aggregate query", async () => {
  const v = await checkQuery(
    "SELECT COUNT(*) AS count FROM records WHERE dataset_id = ?",
    "ds_x",
  );
  assert.equal(v.allowed, true);
  assert.deepEqual(v.reasons, []);
});

test("allows a grouped aggregate query", async () => {
  const v = await checkQuery(
    'SELECT sex AS "group", AVG(age) AS avg_age FROM records WHERE dataset_id = ? GROUP BY sex',
    "ds_x",
  );
  assert.equal(v.allowed, true);
});

test("rejects SELECT * row-level export", async () => {
  const v = await checkQuery("SELECT * FROM records", "ds_x");
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /SELECT \*/.test(r)));
});

test("rejects queries referencing PII columns", async () => {
  const v = await checkQuery(
    "SELECT name, ssn FROM records WHERE dataset_id = ?",
    "ds_x",
  );
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /name/.test(r)));
  assert.ok(v.reasons.some((r) => /ssn/.test(r)));
});

test("rejects single-record LIMIT 1 pulls", async () => {
  const v = await checkQuery(
    "SELECT COUNT(*) FROM records WHERE dataset_id = ? LIMIT 1",
    "ds_x",
  );
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /single record/i.test(r)));
});

test("rejects a non-aggregate query (fail closed)", async () => {
  const v = await checkQuery("SELECT age FROM records", "ds_x");
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /aggregate/i.test(r)));
});

test("checkResult allows results whose every cell is >= MIN_CELL_SIZE", async () => {
  const v = await checkResult([
    { group: "M", count: MIN_CELL_SIZE },
    { group: "F", count: 42 },
  ]);
  assert.equal(v.allowed, true);
  assert.deepEqual(v.reasons, []);
});

test("checkResult suppresses results with a small cell and names it", async () => {
  const v = await checkResult([
    { group: "M", count: 50 },
    { group: "F", count: 3 },
  ]);
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /F/.test(r) && /3/.test(r)));
});

test("checkResult is defensive about row shape and finds alternate count keys", async () => {
  const v = await checkResult([{ label: "2023", n: 2 }]);
  assert.equal(v.allowed, false);
  assert.ok(v.reasons.some((r) => /2023/.test(r)));
});

test("checkResult ignores rows with no interpretable count", async () => {
  const v = await checkResult([{ note: "no count here" }, { count: 20 }]);
  assert.equal(v.allowed, true);
});

test("checkResult fails closed on a non-array", async () => {
  // @ts-expect-error intentionally wrong shape
  const v = await checkResult(null);
  assert.equal(v.allowed, false);
});

test("checkQuestion allows plain-English aggregate questions (no SQL needed)", async () => {
  for (const q of [
    "How many patients by sex?",
    "average age by region",
    "What is the oldest age in the cohort?",
    "count of patients per diagnosis",
    "How many individuals were admitted in 2023?",
  ]) {
    const v = await checkQuestion(q, "ds_x");
    assert.equal(v.allowed, true, `${q}: ${v.reasons.join("; ")}`);
  }
});

test("checkQuestion rejects identifier mentions in spoken or column form", async () => {
  for (const q of [
    "What are the patient names?",
    "average age by zip code",
    "count by date of birth",
    "group by social_security",
    "show emails of patients",
  ]) {
    const v = await checkQuestion(q, "ds_x");
    assert.equal(v.allowed, false, q);
    assert.ok(
      v.reasons.some((r) => /PII/.test(r)),
      q,
    );
  }
});

test("checkQuestion rejects row-level asks", async () => {
  for (const q of [
    "select * from patients",
    "list all patients",
    "show me the records",
    "age of each patient",
    "individual level data please",
    "export the dataset",
    "give me the raw data",
    "pick one patient over 90",
    "count(*) from records limit 1",
  ]) {
    const v = await checkQuestion(q, "ds_x");
    assert.equal(v.allowed, false, q);
    assert.ok(
      v.reasons.some((r) => /row-level/.test(r)),
      q,
    );
  }
});
