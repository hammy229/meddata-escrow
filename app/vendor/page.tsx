// Vendor workspace (server component). Reads the local catalog and lists the
// datasets a vendor has for sale: title, tags, record count, and price. The
// catalog is read server-side; the grid renders on the client.
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import VendorCatalog, { type CatalogRow } from "../components/VendorCatalog";
import IncomingOrders from "../components/IncomingOrders";
import EarningsSummary from "../components/EarningsSummary";
import OrdersLedger from "../components/OrdersLedger";
import { ArrowLeft } from "../components/icons";

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
    <>
      <SiteNav current="/vendor" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-10 lg:box-content lg:pl-[calc(72px+2.5rem)]">
        <div className="mb-12">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            MedData Escrow
          </Link>
          <h1 className="mt-6 font-serif text-[2.75rem] leading-tight font-normal">
            Vendor workspace
          </h1>
          <p className="mt-3 max-w-2xl font-light text-muted">
            Your listed datasets. Buyers discover these through AI matching and
            pay into escrow; funds are released once delivery is confirmed.
          </p>
        </div>

        <div className="grid grid-cols-2 border-t border-rule pb-6 sm:grid-cols-3">
          <div className="py-5 pr-6 not-first:border-l not-first:border-rule not-first:pl-6">
            <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
              Listings
            </p>
            <p className="mt-2 font-serif text-4xl font-light tabular-nums">
              {rows.length}
            </p>
          </div>
          <div className="py-5 pr-6 not-first:border-l not-first:border-rule not-first:pl-6">
            <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
              Total records
            </p>
            <p className="mt-2 font-serif text-4xl font-light tabular-nums">
              {totalRecords.toLocaleString()}
            </p>
          </div>
          <div className="col-span-2 border-t border-rule py-5 sm:col-span-1 sm:border-t-0 sm:border-l sm:pl-6">
            <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
              Average price
            </p>
            <p className="mt-2 font-serif text-4xl font-light tabular-nums text-pp-600 dark:text-pp-400">
              ${(avgPriceCents / 100).toFixed(2)}
            </p>
          </div>
        </div>

        <section className="border-t border-rule pt-8 pb-10">
          <h2 className="mb-6 font-serif text-[1.6rem] font-normal">Catalog</h2>
          <VendorCatalog rows={rows} />
        </section>

        <section className="border-t border-rule pt-8 pb-10">
          <h2 className="mb-1 font-serif text-[1.6rem] font-normal">
            Earnings
          </h2>
          <p className="mb-6 text-sm font-light text-muted">
            Where your money sits across every order, from held in escrow to
            paid out.
          </p>
          <EarningsSummary />
        </section>

        <section className="border-t border-rule pt-8 pb-10">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="font-serif text-[1.6rem] font-normal">
              Incoming orders
            </h2>
          </div>
          <p className="mb-6 text-sm font-light text-muted">
            Live escrow state for every order. Resolve a disputed order by
            releasing the held funds to you (capture) or refunding the buyer
            (void).
          </p>
          <IncomingOrders />
        </section>

        <section className="border-t border-rule pt-8 pb-10">
          <h2 className="mb-1 font-serif text-[1.6rem] font-normal">
            All orders
          </h2>
          <p className="mb-6 text-sm font-light text-muted">
            The full ledger. Filter by status, amount or date, search
            everything, and export what you see. The total row sums the filtered
            orders.
          </p>
          <OrdersLedger />
        </section>
      </main>
    </>
  );
}
