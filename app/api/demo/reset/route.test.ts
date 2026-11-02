import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "./route";
test("shared demo state cannot be reset through HTTP", async () => {
  const response = await POST();
  assert.equal(response.status, 403);
});
