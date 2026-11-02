import { test } from "node:test";
import assert from "node:assert/strict";

import { trustScore, type TrustEvent, type TrustInput } from "./score";

let n = 0;
/** One order's events with explicit timestamps (seconds after a fixed base). */
function order(
  id: string,
  steps: [string, number][],
): { id: string; events: TrustEvent[] } {
  const base = Date.parse("2026-01-01T00:00:00Z");
  return {
    id,
    events: steps.map(([event, secs], i) => ({
      order_id: id,
      seq: i,
      event,
      created_at: new Date(base + secs * 1000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19),
    })),
  };
}

/** A clean order: authorized, delivered after `hours`, captured. */
function clean(hours = 1) {
  const id = `ord_${n++}`;
  return order(id, [
    ["CREATE", 0],
    ["AUTHORIZE", 10],
    ["DELIVER", 10 + hours * 3600],
    ["CAPTURE", 20 + hours * 3600],
  ]);
}
function disputed(outcome: "RESOLVE_CAPTURE" | "RESOLVE_VOID" | null) {
  const id = `ord_${n++}`;
  const steps: [string, number][] = [
    ["CREATE", 0],
    ["AUTHORIZE", 10],
    ["DELIVER", 3610],
    ["DISPUTE", 4000],
  ];
  if (outcome) steps.push([outcome, 5000]);
  return order(id, steps);
}

const input = (
  orders: { id: string; events: TrustEvent[] }[],
  sampleChecks: boolean[] = [true],
): TrustInput => ({ orders, sampleChecks });

const factor = (r: ReturnType<typeof trustScore>, key: string) => {
  const f = r.factors.find((x) => x.key === key);
  assert.ok(f, `missing factor ${key}`);
  return f;
};

test("no history is a neutral middling score, never perfect", () => {
  const r = trustScore({ orders: [], sampleChecks: [] });
  assert.ok(r.score > 30 && r.score < 70, `got ${r.score}`);
  assert.equal(r.factors.length, 5);
  for (const f of r.factors) assert.ok(f.reason.length > 10);
});

test("a single clean order does not look perfect (shrinkage)", () => {
  const r = trustScore(input([clean()]));
  assert.ok(r.score < 90, `got ${r.score}`);
});

test("more clean history scores strictly higher", () => {
  const few = trustScore(input([clean(), clean()]));
  const many = trustScore(
    input(
      Array.from({ length: 40 }, () => clean()),
      Array.from({ length: 20 }, () => true),
    ),
  );
  assert.ok(many.score > few.score);
  assert.ok(many.score >= 85, `got ${many.score}`);
  assert.equal(many.grade, "A");
});

test("disputes lower the score and report the rate", () => {
  const good = trustScore(input(Array.from({ length: 10 }, () => clean())));
  const orders = [
    ...Array.from({ length: 7 }, () => clean()),
    ...Array.from({ length: 3 }, () => disputed(null)),
  ];
  const bad = trustScore(input(orders));
  assert.ok(bad.score < good.score);
  assert.match(factor(bad, "disputeRate").reason, /3 of 10/);
});

test("losing disputes hurts more than winning them", () => {
  const base = Array.from({ length: 6 }, () => clean());
  const won = trustScore(
    input([...base, disputed("RESOLVE_CAPTURE"), disputed("RESOLVE_CAPTURE")]),
  );
  const lost = trustScore(
    input([...base, disputed("RESOLVE_VOID"), disputed("RESOLVE_VOID")]),
  );
  assert.ok(won.score > lost.score);
  assert.ok(
    factor(won, "disputeOutcomes").value >
      factor(lost, "disputeOutcomes").value,
  );
});

test("failing sample checks lower the score", () => {
  const orders = Array.from({ length: 10 }, () => clean());
  const pass = trustScore(input(orders, [true, true, true]));
  const fail = trustScore(input(orders, [true, false, false]));
  assert.ok(pass.score > fail.score);
  assert.match(factor(fail, "sampleChecks").reason, /1 of 3/);
});

test("faster delivery beats slower delivery", () => {
  const fast = trustScore(input(Array.from({ length: 10 }, () => clean(0.5))));
  const slow = trustScore(input(Array.from({ length: 10 }, () => clean(80))));
  assert.ok(fast.score > slow.score);
  assert.match(factor(fast, "deliverySpeed").reason, /median/i);
});

test("an order that was never delivered contributes no speed sample", () => {
  const r = trustScore(
    input([
      order("o", [
        ["CREATE", 0],
        ["AUTHORIZE", 5],
      ]),
    ]),
  );
  assert.match(factor(r, "deliverySpeed").reason, /no delivered/i);
});

test("score is an integer in 0..100 and weights sum to 100", () => {
  const worst = trustScore(
    input(
      Array.from({ length: 50 }, () => disputed("RESOLVE_VOID")),
      [false, false],
    ),
  );
  const best = trustScore(
    input(
      Array.from({ length: 200 }, () => clean(0.1)),
      [true, true, true],
    ),
  );
  for (const r of [worst, best]) {
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100);
    assert.equal(
      r.factors.reduce((s, f) => s + f.weight, 0),
      100,
    );
  }
  assert.ok(worst.score < 40, `got ${worst.score}`);
  assert.equal(worst.grade, "F");
  assert.equal(best.grade, "A");
});

test("is pure: same input, same output, input untouched", () => {
  const i = input([clean(), disputed("RESOLVE_VOID")]);
  const snapshot = JSON.stringify(i);
  assert.deepEqual(trustScore(i), trustScore(i));
  assert.equal(JSON.stringify(i), snapshot);
});

test("malformed timestamps are ignored rather than crashing", () => {
  const o = order("bad", [
    ["CREATE", 0],
    ["AUTHORIZE", 1],
    ["DELIVER", 2],
  ]);
  o.events[1].created_at = "not a date";
  const r = trustScore(input([o]));
  assert.ok(Number.isFinite(r.score));
});
