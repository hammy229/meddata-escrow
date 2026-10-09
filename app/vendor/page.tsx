// Vendor workspace (server component). Reads the local catalog and lists the
// datasets a vendor has for sale: title, tags, record count, and price. The
// catalog is read server-side; the grid renders on the client.
import Link from "next/link";
import VendorCatalog, { type CatalogRow } from "../components/VendorCatalog";

interface CatalogEntry {
  id: string;
  title: string;
  tags: string[];
  priceCents: number;
  recordCount: number;
}

// Static catalog metadata (synthetic listings) — safe to read at build time.
import catalog from "../../data/catalog.json";

export default function VendorPage() {
  const rows: CatalogRow[] = (catalog as CatalogEntry[]).map((d) => ({
    id: d.id,
    title: d.title,
    tags: d.tags ?? [],
    priceCents: d.priceCents,
    recordCount: d.recordCount,
  }));

  const totalRecords = rows.reduce((sum, r) => sum + (r.recordCount || 0), 0);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
      <div className="mb-8">
        <Link
          href="/"
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          ← MedData Escrow
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Vendor workspace
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Your listed datasets. Buyers discover these through AI matching and
          pay into escrow; funds are released once delivery is confirmed.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Listings
          </p>
          <p className="mt-1 text-2xl font-semibold">{rows.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Total records
          </p>
          <p className="mt-1 text-2xl font-semibold">
            {totalRecords.toLocaleString()}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 className="mb-4 text-lg font-medium">Catalog</h2>
        <VendorCatalog rows={rows} />
      </section>
    </main>
  );
}
