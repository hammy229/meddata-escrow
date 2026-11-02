import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { AppDatabase as DatabaseSync } from "../db/connection";
import { withDb } from "../db/store";
export const SESSION_COOKIE = "meddata_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 7;
export type Role = "researcher" | "vendor";
export interface Account {
  id: string;
  email: string;
  name: string;
  role: Role;
  organization: string;
  purpose: string;
  payout_email: string;
  vendor_id: string | null;
  setup_complete: number;
}
const columns =
  "id, email, name, role, organization, purpose, payout_email, vendor_id, setup_complete";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hex] = stored.split(":");
  const key = await derive(password, salt);
  const expected = Buffer.from(hex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}
export async function register(input: {
  name: string;
  email: string;
  password: string;
  role: Role;
}): Promise<Account> {
  const hash = await hashPassword(input.password);
  return await withDb(async (db) => {
    const id = randomUUID();
    await db
      .prepare(
        "INSERT INTO accounts (id, email, name, role, password_hash) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, input.email.toLowerCase().trim(), input.name, input.role, hash);
    return (await db
      .prepare(`SELECT ${columns} FROM accounts WHERE id = ?`)
      .get(id)) as unknown as Account;
  });
}
// Equal-cost verification for unknown email addresses avoids a fast enumeration path.
const dummyHash = `00000000000000000000000000000000:${"00".repeat(64)}`;
export async function authenticate(
  email: string,
  password: string,
): Promise<Account | null> {
  const row = (await withDb(
    async (db) =>
      await db
        .prepare(
          `SELECT ${columns}, password_hash FROM accounts WHERE lower(email) = ?`,
        )
        .get(email.toLowerCase().trim()),
  )) as
    | (Account & {
        password_hash: string;
      })
    | undefined;
  const valid = await verifyPassword(password, row?.password_hash ?? dummyHash);
  if (!row || !valid) return null;
  const { password_hash: _, ...account } = row;
  void _;
  return account;
}
export async function createSession(accountId: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await withDb(async (db) => {
    await db
      .prepare("DELETE FROM sessions WHERE expires_at <= ?")
      .run(Date.now());
    await db
      .prepare(
        "INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)",
      )
      .run(digest(token), accountId, Date.now() + SESSION_SECONDS * 1000);
  });
  return token;
}
export async function sessionAccount(token?: string): Promise<Account | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (
    (await withDb(
      async (db) =>
        (await db
          .prepare(
            `SELECT ${columns
              .split(", ")
              .map((c) => `a.${c}`)
              .join(
                ", ",
              )} FROM accounts a JOIN sessions s ON s.account_id = a.id WHERE s.token_hash = ? AND s.expires_at > ?`,
          )
          .get(digest(token), Date.now())) as unknown as Account | undefined,
    )) ?? null
  );
}
export async function deleteSession(token: string): Promise<void> {
  await withDb(
    async (db) =>
      await db
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .run(digest(token)),
  );
}
export function cookieToken(request: Request): string | undefined {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
}
export async function completeSetup(
  account: Account,
  input: {
    organization: string;
    purpose: string;
    payoutEmail: string;
  },
): Promise<void> {
  await withDb(async (db) => {
    await db.exec("BEGIN IMMEDIATE");
    try {
      let vendorId = account.vendor_id;
      if (account.role === "vendor") {
        vendorId ??= `vnd_${account.id}`;
        await db
          .prepare(
            "INSERT INTO vendors (id, name, payout_email) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, payout_email = excluded.payout_email",
          )
          .run(vendorId, input.organization, input.payoutEmail);
      }
      await db
        .prepare(
          "UPDATE accounts SET organization = ?, purpose = ?, payout_email = ?, vendor_id = ?, setup_complete = 1 WHERE id = ?",
        )
        .run(
          input.organization,
          input.purpose,
          account.role === "vendor" ? input.payoutEmail : "",
          vendorId,
          account.id,
        );
      await db.exec("COMMIT");
    } catch (err) {
      await db.exec("ROLLBACK");
      throw err;
    }
  });
}
export async function ownsOrder(
  db: DatabaseSync,
  account: Account,
  orderId: string,
): Promise<boolean> {
  return !!(await db
    .prepare(
      `SELECT 1 FROM orders o JOIN datasets d ON d.id = o.dataset_id WHERE o.id = ? AND ${account.role === "researcher" ? "o.account_id = ?" : "d.vendor_id = ?"}`,
    )
    .get(
      orderId,
      account.role === "researcher" ? account.id : account.vendor_id,
    ));
}
export async function ownsRun(
  account: Account,
  runId: string,
): Promise<boolean> {
  return await withDb(
    async (db) =>
      !!(await db
        .prepare(
          "SELECT 1 FROM account_agent_runs WHERE run_id = ? AND account_id = ?",
        )
        .get(runId, account.id)),
  );
}
