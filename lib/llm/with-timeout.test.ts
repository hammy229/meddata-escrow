import assert from "node:assert/strict";
import { test } from "node:test";

import { withTimeout } from "./client";

test("a call that throws right away leaves no timer to crash the process", async () => {
  const stray: unknown[] = [];
  const onStray = (e: unknown) => stray.push(e);
  process.on("unhandledRejection", onStray);
  try {
    await assert.rejects(
      withTimeout(5, () => {
        throw new Error("sync");
      }),
      /sync/,
    );
    await new Promise((r) => setTimeout(r, 30));
    assert.deepEqual(stray, []);
  } finally {
    process.off("unhandledRejection", onStray);
  }
});
