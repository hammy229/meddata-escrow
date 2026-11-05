import assert from "node:assert/strict";
import { test } from "node:test";

import { withheldCells } from "./suppression";

const sizes = (o: Record<string, number>) => new Map(Object.entries(o));

test("nothing is withheld when every group clears the floor", () => {
  assert.deepEqual([...withheldCells(sizes({ a: 11, b: 40 }), 11)], []);
});

test("a small group takes the next smallest group with it", () => {
  const out = withheldCells(sizes({ a: 5, b: 20, c: 90 }), 11);
  assert.deepEqual([...out].sort(), ["a", "b"]);
});

test("two small groups can be subtracted only as a sum at the floor", () => {
  // 6 + 7 clears the floor, so their sum cannot single anyone out.
  const out = withheldCells(sizes({ a: 6, b: 7, c: 90 }), 11);
  assert.deepEqual([...out].sort(), ["a", "b"]);
});

test("two small groups under the floor together take another group", () => {
  const out = withheldCells(sizes({ a: 2, b: 3, c: 50, d: 90 }), 11);
  assert.deepEqual([...out].sort(), ["a", "b", "c"]);
});

test("a lone group under the floor is withheld", () => {
  assert.deepEqual([...withheldCells(sizes({ "": 5 }), 11)], [""]);
});

test("subtraction from the total never reveals a cell under the floor", () => {
  for (let small = 1; small < 11; small += 1) {
    for (const other of [11, 12, 30]) {
      const groups = sizes({ small, other, big: 200 });
      const hidden = withheldCells(groups, 11);
      const total = small + other + 200;
      const shown = [...groups]
        .filter(([k]) => !hidden.has(k))
        .reduce((s, [, n]) => s + n, 0);
      assert.ok(total - shown >= 11, `recovered ${total - shown}`);
    }
  }
});
