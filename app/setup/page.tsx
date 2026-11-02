import { redirect } from "next/navigation";
import AccountShell from "../components/AccountShell";
import AccountForm from "../components/AccountForm";
import { currentAccount } from "../../lib/auth/page";
import AccountMenu from "../components/AccountMenu";
export default async function Setup() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  return (
    <AccountShell
      step="02 / Workspace setup"
      title={
        account.role === "researcher"
          ? "Tell us about your research"
          : "Set up your data organization"
      }
      description={`Signed in as ${account.email}. ${account.role === "researcher" ? "Add your institution and research focus to get started." : "Add your organization and payment details to prepare your provider workspace."}`}
    >
      <AccountForm mode="setup" initialRole={account.role} initial={account} />
      <div className="mt-8">
        <AccountMenu name={account.name} />
      </div>
    </AccountShell>
  );
}
