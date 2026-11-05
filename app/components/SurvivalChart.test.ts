import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SurvivalChart, { PValues } from "./SurvivalChart";
import { fixtureCohort } from "../../lib/fitness/source";
import {
  survivalAnalysis,
  type SurvivalAnalysis,
} from "../../lib/query/survival-analysis";

function analysisFor(groupBy: "arm" | "age_band"): SurvivalAnalysis {
  const out = survivalAnalysis(
    fixtureCohort("ds_als_survival_axonpoint_v1", "delivery")!,
    groupBy,
  );
  assert.equal(out.kind, "ok");
  return (out as { kind: "ok"; analysis: SurvivalAnalysis }).analysis;
}

test("the chart draws every group with a distinct dash, labels and tables", () => {
  const a = analysisFor("age_band");
  const html = renderToStaticMarkup(
    createElement(SurvivalChart, { analysis: a }),
  );
  assert.match(html, /SYNTHETIC/);
  assert.match(html, /Months since index/);
  assert.match(html, /Share surviving/);
  assert.match(html, /People at risk/);
  assert.match(html, /<table/);
  assert.match(html, /role="img"/);
  assert.deepEqual(
    a.groups.map((g) => g.group),
    ["<50", "50-59", "60-69", "70+"],
  );
  for (const g of a.groups) {
    const text = `Age ${g.group}`.replace(/</g, "&lt;");
    assert.ok(html.includes(text), text);
  }
  assert.match(html, /<title[^>]*>Kaplan-Meier survival curves by age band/);
  const dashes = new Set(
    [...html.matchAll(/<path d="M[^"]*"[^>]*stroke-dasharray="([^"]+)"/g)].map(
      (m) => m[1],
    ),
  );
  assert.ok(dashes.size >= a.groups.length - 1, "dashed groups differ");
  assert.equal(/subject_key/.test(html), false);
});

test("the p values show raw and age-adjusted side by side for arm", () => {
  const html = renderToStaticMarkup(
    createElement(PValues, { analysis: analysisFor("arm") }),
  );
  assert.match(html, /Raw comparison/);
  assert.match(html, /Within age bands/);
  assert.match(html, /below 0\.001/);
  assert.match(html, /does not show cause/);
  const other = renderToStaticMarkup(
    createElement(PValues, { analysis: analysisFor("age_band") }),
  );
  assert.doesNotMatch(other, /Within age bands/);
});
