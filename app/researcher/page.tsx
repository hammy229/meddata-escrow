import { requireAccount } from "../../lib/auth/page";
import ResearcherWorkspace from "./Workspace";
export default async function ResearcherPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const account = await requireAccount("researcher");
  return (
    <ResearcherWorkspace
      searchParams={searchParams}
      initialStudy={account.purpose}
    />
  );
}
