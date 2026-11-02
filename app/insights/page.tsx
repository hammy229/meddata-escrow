// Marketplace insights (server component shell). The figures load client-side
// from GET /api/insights so they stay live while orders move.
import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import InsightsDashboard from "../components/InsightsDashboard";
import { ArrowLeft } from "../components/icons";

export const metadata: Metadata = {
  title: "Insights",
  description:
    "Money held in escrow versus released, platform fees, dispute rate and the top vendors and datasets.",
};

export default function InsightsPage() {
  return (
    <>
      <SiteNav current="/insights" />
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
            Insights
          </h1>
          <p className="mt-3 max-w-2xl font-light text-muted">
            Where the money sits across the marketplace: held in escrow,
            released to vendors, and kept as platform fee. Every figure is
            computed from the live order book.
          </p>
        </div>
        <InsightsDashboard />
      </main>
    </>
  );
}
