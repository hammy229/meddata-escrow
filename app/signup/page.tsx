import { redirect } from "next/navigation";
import AccountShell from "../components/AccountShell";
import AccountForm from "../components/AccountForm";
import { currentAccount } from "../../lib/auth/page";
export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const account = await currentAccount();
  if (account) redirect(account.setup_complete ? `/${account.role}` : "/setup");
  const { role } = await searchParams;
  return (
    <AccountShell
      step="01 / Create account"
      title="Make room for discovery"
      description="Choose a workspace. We’ll help you set it up next."
    >
      <AccountForm
        mode="signup"
        initialRole={role === "vendor" ? "vendor" : "researcher"}
      />
    </AccountShell>
  );
}
