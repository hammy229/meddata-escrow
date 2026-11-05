// Guided demo (server component shell). The walkthrough itself is a client
// component that drives the real APIs; see app/demo/story.ts.
import type { Metadata } from "next";
import Link from "next/link";
import SiteNav from "../components/SiteNav";
import GuidedDemo from "../components/GuidedDemo";
import { ArrowLeft } from "../components/icons";

export const metadata: Metadata = {
  title: "Guided demo",
  description:
    "A narrated walkthrough: match, sample check, escrow hold, delivery, query and release, then a delivery that fails its audit and a survival chart on synthetic data.",
};

export default function DemoPage() {
  return (
    <>
      <SiteNav current="/demo" />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-12 sm:px-10 lg:box-content lg:pl-[calc(72px+2.5rem)]">
        <div className="mb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            MedData Escrow
          </Link>
          <h1 className="mt-6 font-serif text-[2.75rem] leading-tight font-normal">
            Guided demo
          </h1>
          <p className="mt-3 max-w-2xl font-light text-muted">
            Watch an order travel the whole escrow arc, then a delivery fail its audit. Payment is held when
            the buyer approves and released only after delivery that holds up.
          </p>
        </div>
        <GuidedDemo />
      </main>
    </>
  );
}
