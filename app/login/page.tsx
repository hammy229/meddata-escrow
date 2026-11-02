import { redirect } from "next/navigation";
import AccountShell from "../components/AccountShell";
import AccountForm from "../components/AccountForm";
import { currentAccount } from "../../lib/auth/page";
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const account = await currentAccount();
  if (account) redirect(account.setup_complete ? `/${account.role}` : "/setup");
  const { role } = await searchParams;
  return (
    <AccountShell
      step="Welcome back"
      title="Sign in to your workspace"
      description="Continue your research or manage your datasets and deliveries."
    >
      <AccountForm
        mode="login"
        initialRole={role === "vendor" ? "vendor" : "researcher"}
      />
    </AccountShell>
  );
}
