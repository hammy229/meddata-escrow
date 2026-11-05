import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createSession, register, sessionAccount } from "./store";

test("the session account can be passed to a client component", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meddata-session-"));
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = join(dir, "session.sqlite");
  try {
    const account = await register({
      name: "Plain Row",
      email: "plain@example.com",
      password: "test password long enough",
      role: "researcher",
    });
    const found = await sessionAccount(await createSession(account.id));
    // React rejects null-prototype objects, which is what node:sqlite returns.
    assert.equal(Object.getPrototypeOf(found), Object.prototype);
    assert.equal(found?.email, "plain@example.com");
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
