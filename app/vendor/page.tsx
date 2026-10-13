// Vendor workspace (server component). Reads the local catalog and lists the
// datasets a vendor has for sale: title, tags, record count, and price. The
// catalog is read server-side; the grid renders on the client.
import Link from "next/link";
import VendorCatalog, { type CatalogRow } from "../components/VendorCatalog";
import IncomingOrders from "../components/IncomingOrders";
import { ArrowLeft, Database } from "../components/icons";

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
  const avgPriceCents = rows.length
    ? Math.round(rows.reduce((s, r) => s + r.priceCents, 0) / rows.length)
    : 0;

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:hover:text-zinc-200"
        >
          <ArrowLeft className="h-4 w-4" />
          MedData Escrow
        </Link>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">
          Vendor workspace
        </h1>
        <p className="mt-2 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Your listed datasets. Buyers discover these through AI matching and
          pay into escrow; funds are released once delivery is confirmed.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Listings
          </p>
          <p className="mt-1 text-2xl font-bold tracking-tight">
            {rows.length}
          </p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Total records
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight">
            {totalRecords.toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:col-span-1 dark:border-zinc-800 dark:bg-zinc-900/40">
          <p className="text-xs uppercase tracking-wider text-zinc-500">
            Average price
          </p>
          <p className="mt-1 font-mono text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            ${(avgPriceCents / 100).toFixed(2)}
          </p>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900/40 dark:shadow-black/20">
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          Catalog
        </h2>
        <VendorCatalog rows={rows} />
      </section>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-900/40 dark:shadow-black/20">
        <div className="mb-1 flex items-center gap-2">
          <h2 className="text-lg font-semibold">Incoming orders</h2>
        </div>
        <p className="mb-4 text-sm text-zinc-500">
          Live escrow state for every order. Resolve a disputed order by
          releasing the held funds to you (capture) or refunding the buyer
          (void).
        </p>
        <IncomingOrders />
      </section>
    </main>
  );
}
