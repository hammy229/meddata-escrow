import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { POST } from "./route";

// Matches LOGIN_ATTEMPTS_PER_EMAIL in route.ts (route files may not export it).
const LOGIN_ATTEMPTS_PER_EMAIL = 10;

const login = (email: string, ip: string) =>
  POST(
    new Request("http://localhost/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ email, password: "wrong password here" }),
    }),
    { params: Promise.resolve({ action: "login" }) },
  );

test("faking a new IP per try does not get around the login limit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "meddata-login-"));
  const saved = process.env.DATABASE_URL;
  process.env.DATABASE_URL = join(dir, "auth.sqlite");
  try {
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_EMAIL; i++) {
      const res = await login("victim@example.com", `203.0.113.${i}`);
      assert.equal(res.status, 401);
    }
    const blocked = await login("Victim@example.com", "198.51.100.9");
    assert.equal(blocked.status, 429);
    // Other accounts are not affected.
    assert.equal((await login("other@example.com", "198.51.100.9")).status, 401);
  } finally {
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});
