import { requireAccount } from "../../lib/auth/page";
import AccountMenu from "../components/AccountMenu";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const account = await requireAccount("researcher");
  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-5 pt-6 sm:px-10 lg:box-content lg:pl-[calc(72px+2.5rem)]">
        <AccountMenu name={`${account.name} · ${account.organization}`} />
      </div>
      {children}
    </>
  );
}
