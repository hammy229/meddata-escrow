import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, sessionAccount, type Role } from "./store";
export async function currentAccount() {
  return await sessionAccount((await cookies()).get(SESSION_COOKIE)?.value);
}
export async function requireAccount(role?: Role) {
  const account = await currentAccount();
  if (!account) redirect(`/login${role ? `?role=${role}` : ""}`);
  if (!account.setup_complete) redirect("/setup");
  if (role && account.role !== role)
    redirect(`/${account.role === "vendor" ? "vendor" : "researcher"}`);
  return account;
}
