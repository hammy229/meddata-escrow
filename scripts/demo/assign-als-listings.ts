// Local demo helper: give a signed-in vendor account the three SYNTHETIC ALS
// listings, so that vendor can deliver them from /vendor.
//
// Why: a vendor may only deliver listings their own account owns, and the
// seeded ALS listings belong to seed vendors (vnd_axonpoint_synth and so on).
// A real vendor id is vnd_<accountId>. The public /demo walkthrough needs none
// of this, because it runs without an account. Run this only on a local or
// throwaway database; it re-points listings and does not undo itself.
//
//   node --import tsx --env-file-if-exists=.env.local \
//     scripts/demo/assign-als-listings.ts --email you@example.com
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  closeAppDatabase,
  transaction,
  withDb,
  type AppDatabase,
} from "../../lib/db/connection";

/** Ids of every catalog listing that has a synthetic fixture. */
function fixtureListingIds(): string[] {
  const catalog = JSON.parse(
    readFileSync(new URL("../../data/catalog.json", import.meta.url), "utf8"),
  ) as { id: string; fixture?: unknown }[];
  return catalog.filter((d) => d.fixture).map((d) => d.id);
}

export function parseArgs(argv: string[]): { email?: string; error?: string } {
  if (argv.length === 2 && argv[0] === "--email" && argv[1].includes("@"))
    return { email: argv[1] };
  return {
    error: "Usage: assign-als-listings.ts --email <vendor account email>",
  };
}

export async function assignAlsListings(
  db: AppDatabase,
  email: string,
): Promise<{ vendorId: string; datasetIds: string[] }> {
  const account = (await db
    .prepare("SELECT role, vendor_id FROM accounts WHERE email = ?")
    .get(email.toLowerCase().trim())) as
    { role: string; vendor_id: string | null } | undefined;
  if (!account) throw new Error(`No account with that email.`);
  if (account.role !== "vendor")
    throw new Error("That account is not a vendor.");
  if (!account.vendor_id)
    throw new Error(
      "Finish the vendor setup in the app first, then run this again.",
    );
  const vendorId = account.vendor_id;
  const datasetIds: string[] = [];
  await transaction(db, async () => {
    for (const id of fixtureListingIds()) {
      const { changes } = await db
        .prepare("UPDATE datasets SET vendor_id = ? WHERE id = ?")
        .run(vendorId, id);
      if (changes > 0) datasetIds.push(id);
    }
  });
  return { vendorId, datasetIds };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email) {
    console.error(args.error);
    process.exitCode = 1;
    return;
  }
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to run with NODE_ENV=production.");
    process.exitCode = 1;
    return;
  }
  try {
    const out = await withDb((db) => assignAlsListings(db, args.email!));
    console.log(
      `Assigned ${out.datasetIds.length} synthetic ALS listings to ${out.vendorId}:`,
    );
    for (const id of out.datasetIds) console.log(`  ${id}`);
    if (out.datasetIds.length === 0)
      console.log("No ALS listings were found. Run npm run db:seed first.");
  } catch (err) {
    console.error(err instanceof Error ? err.message : "Assignment failed.");
    process.exitCode = 1;
  } finally {
    await closeAppDatabase();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  void main();
