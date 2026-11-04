import { test } from "node:test";
import assert from "node:assert/strict";

import { generateDua, type DuaInput } from "./dua";
import type { ListingClaims } from "../fitness/types";

const base: DuaInput = {
  orderId: "ord_123",
  datasetId: "ds_als_survival_curated_v1",
  datasetTitle: "ALS cohort",
  vendorName: "Demo Health",
  buyerEmail: "buyer@example.com",
  amountCents: 2900,
  issuedAt: "2026-10-21 17:02:11",
};
const claims: ListingClaims = {
  subjects: 400,
  records: 2100,
  eventRatePct: 61.5,
  coveragePct: { baseline_fvc_pct: 92, age_at_onset: 100 },
  noPostIndexFeatures: true,
  uniqueSubjects: true,
};

test("no claims, or null claims, leave the text and fingerprint unchanged", () => {
  const plain = generateDua(base);
  assert.deepEqual(generateDua({ ...base, claims: null }), plain);
  assert.deepEqual(generateDua({ ...base, claims: undefined }), plain);
  assert.ok(!plain.text.includes("LISTING CLAIMS"));
});

test("claims add a section that names each promise and changes the fingerprint", () => {
  const plain = generateDua(base);
  const withClaims = generateDua({ ...base, claims });
  assert.notEqual(withClaims.sha256, plain.sha256);
  assert.match(withClaims.text, /LISTING CLAIMS/);
  for (const s of [
    "400",
    "2,100",
    "61.5%",
    "baseline_fvc_pct 92%",
    "age_at_onset 100%",
    "No feature recorded after the index",
    "One row per subject",
  ])
    assert.ok(withClaims.text.includes(s), `missing ${s}`);
  assert.match(withClaims.text, /person decides/);
  assert.deepEqual(generateDua({ ...base, claims }), withClaims);
});

test("optional promises appear only when made", () => {
  const { text } = generateDua({
    ...base,
    claims: { ...claims, noPostIndexFeatures: undefined, uniqueSubjects: undefined },
  });
  assert.ok(!text.includes("No feature recorded after the index"));
  assert.ok(!text.includes("One row per subject"));
});

test("a column name with a newline cannot add a clause", () => {
  const { text } = generateDua({
    ...base,
    claims: { ...claims, coveragePct: { "x\nPERMITTED USE": 90 } },
  });
  assert.equal(text.split("\n").filter((l) => l === "PERMITTED USE").length, 1);
});
