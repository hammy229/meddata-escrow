import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FitnessAuditCard, { heldReason, sortFindings } from "./FitnessAuditCard";
import type { FitnessReport } from "../../lib/fitness/types";

const report = {
  datasetId: "ds_x",
  stage: "delivery",
  synthetic: true,
  verdict: "fail",
  disclaimer: "This is a screen, not proof.",
  methodVersion: 1,
  findings: [
    {
      id: "coverage",
      severity: "pass",
      title: "Coverage fine",
      reason: "All there.",
    },
    {
      // An id the component has never heard of must still render.
      id: "brand_new_check",
      severity: "fail",
      title: "Something new broke",
      reason: "A new reason.",
      column: "some_col",
      metric: { share_pct: 12.5, rows: "400" },
    },
  ],
} as unknown as FitnessReport;

test("a finding with an unknown id renders from title, reason and metric", () => {
  const html = renderToStaticMarkup(
    createElement(FitnessAuditCard, { heading: "Delivery audit", report }),
  );
  assert.match(html, /Something new broke/);
  assert.match(html, /A new reason\./);
  assert.match(html, /some_col/);
  assert.match(html, /share pct/);
  assert.match(html, /12\.5/);
  assert.match(html, /SYNTHETIC/);
  assert.match(html, /screen, not proof/);
  // Problems come before passes.
  assert.ok(
    html.indexOf("Something new broke") < html.indexOf("Coverage fine"),
  );
});

test("heldReason is plain and differs by side", () => {
  const blocked = { verdict: "fail", blocking: true } as const;
  assert.match(heldReason(blocked, "researcher")!, /Your payment stays held/);
  assert.match(heldReason(blocked, "vendor")!, /The money is held/);
  assert.match(
    heldReason({ verdict: "inconclusive", blocking: false }, "researcher")!,
    /could not reach a verdict/,
  );
  assert.match(
    heldReason({ verdict: "warn", blocking: false }, "vendor")!,
    /Warnings do not hold payment/,
  );
  assert.equal(
    heldReason({ verdict: "pass", blocking: false }, "vendor"),
    null,
  );
  for (const r of ["researcher", "vendor"] as const)
    assert.equal(/proof|tamper/i.test(heldReason(blocked, r)!), false);
});

test("a broken claim leads, then problems, with passes last", () => {
  const order = sortFindings([
    { id: "coverage", severity: "pass" },
    { id: "leak_impact", severity: "info" },
    { id: "imbalance", severity: "fail" },
    { id: "claim", severity: "fail" },
    { id: "drift", severity: "warn" },
  ]).map((f) => f.id);
  assert.deepEqual(order, [
    "claim",
    "imbalance",
    "drift",
    "leak_impact",
    "coverage",
  ]);
});
