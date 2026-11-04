import assert from "node:assert/strict";
import { test } from "node:test";

import { fingerprintRows } from "./fingerprint";

const rows = [
  { subject_key: "s1", age: 61.2, died: 1 },
  { subject_key: "s2", age: 55, died: 0 },
];

test("the fingerprint is a SHA-256 hex digest and is stable", () => {
  const f = fingerprintRows({ subjects: rows });
  assert.match(f, /^[0-9a-f]{64}$/);
  assert.equal(f, fingerprintRows({ subjects: rows.map((r) => ({ ...r })) }));
});

test("column order and float noise do not change it", () => {
  const a = fingerprintRows({ subjects: [{ x: 0.1 + 0.2, y: "a" }] });
  const b = fingerprintRows({ subjects: [{ y: "a", x: 0.3 }] });
  assert.equal(a, b);
});

test("a changed value, a changed row order or a changed table name changes it", () => {
  const base = fingerprintRows({ subjects: rows });
  assert.notEqual(
    base,
    fingerprintRows({ subjects: [{ ...rows[0], died: 0 }, rows[1]] }),
  );
  assert.notEqual(base, fingerprintRows({ subjects: [rows[1], rows[0]] }));
  assert.notEqual(base, fingerprintRows({ visits: rows }));
  assert.notEqual(base, fingerprintRows({ subjects: rows.slice(0, 1) }));
});

test("rounding only hides differences below six decimals", () => {
  const a = fingerprintRows({ t: [{ v: 1.0000001 }] });
  assert.equal(a, fingerprintRows({ t: [{ v: 1 }] }));
  assert.notEqual(a, fingerprintRows({ t: [{ v: 1.001 }] }));
});

test("null, missing, empty and odd values do not throw or collide", () => {
  assert.match(fingerprintRows({}), /^[0-9a-f]{64}$/);
  assert.match(fingerprintRows({ t: [] }), /^[0-9a-f]{64}$/);
  const withNull = fingerprintRows({ t: [{ v: null }] });
  const withText = fingerprintRows({ t: [{ v: "null" }] });
  assert.notEqual(withNull, withText);
  assert.match(
    fingerprintRows({ t: [{ v: "café \u{1F600} ' OR 1=1 --", n: NaN }] }),
    /^[0-9a-f]{64}$/,
  );
});

test("handles a large table", () => {
  const big = Array.from({ length: 20000 }, (_, i) => ({ k: `s${i}`, v: i / 7 }));
  assert.match(fingerprintRows({ t: big }), /^[0-9a-f]{64}$/);
});
