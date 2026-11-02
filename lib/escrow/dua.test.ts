import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { generateDua, type DuaInput } from "./dua";

const base: DuaInput = {
  orderId: "ord_123",
  datasetId: "ds_cardio_synthea_v1",
  datasetTitle: "Cardio Cohort",
  vendorName: "Demo Health",
  buyerEmail: "buyer@example.com",
  amountCents: 4900,
  issuedAt: "2026-10-21 17:02:11",
};

test("the text states permitted use, no re-identification, aggregate-only and retention", () => {
  const { text } = generateDua(base);
  assert.match(text, /PERMITTED USE/);
  assert.match(text, /re-identif/i);
  assert.match(text, /aggregate/i);
  assert.match(text, /RETENTION/);
});

test("the text names parties, order id, amount and timestamp", () => {
  const { text } = generateDua(base);
  for (const s of [
    "Demo Health",
    "buyer@example.com",
    "ord_123",
    "Cardio Cohort",
    "$49.00",
    "2026-10-21 17:02:11",
  ])
    assert.ok(text.includes(s), `missing ${s}`);
});

test("sha256 is the hex digest of the exact text", () => {
  const { text, sha256 } = generateDua(base);
  assert.match(sha256, /^[0-9a-f]{64}$/);
  assert.equal(sha256, createHash("sha256").update(text, "utf8").digest("hex"));
});

test("generation is deterministic", () => {
  assert.deepEqual(generateDua(base), generateDua({ ...base }));
});

test("changing any term changes the fingerprint", () => {
  const h = generateDua(base).sha256;
  for (const change of [
    { amountCents: 4901 },
    { orderId: "ord_124" },
    { buyerEmail: "other@example.com" },
    { issuedAt: "2026-10-22 00:00:00" },
  ])
    assert.notEqual(generateDua({ ...base, ...change }).sha256, h);
});

test("newlines in names cannot inject extra clauses", () => {
  const { text } = generateDua({
    ...base,
    vendorName: "Evil\n\nPERMITTED USE: anything",
  });
  assert.equal(text.match(/^PERMITTED USE/gm)?.length, 1);
});

test("no em or en dashes and unicode names survive", () => {
  const { text } = generateDua({ ...base, vendorName: "Klinik Zürich 🏥" });
  assert.doesNotMatch(text, new RegExp("[\\u2013\\u2014]"));
  assert.ok(text.includes("Klinik Zürich 🏥"));
});

test("zero and large amounts format as dollars", () => {
  assert.ok(generateDua({ ...base, amountCents: 0 }).text.includes("$0.00"));
  assert.ok(
    generateDua({ ...base, amountCents: 123456789 }).text.includes(
      "$1,234,567.89",
    ),
  );
});
