import Link from "next/link";
import { ShieldCheck } from "./icons";
export default function AccountShell({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto grid min-h-screen max-w-6xl lg:grid-cols-2">
        <aside className="flex flex-col justify-between border-b border-rule px-6 py-8 sm:px-12 lg:border-r lg:border-b-0 lg:py-12">
          <Link href="/" className="inline-flex items-center gap-2 text-sm">
            <ShieldCheck className="h-5 w-5" />
            MedData Escrow
          </Link>
          <div className="py-12 lg:py-24">
            <p className="font-mono text-xs tracking-widest text-muted uppercase">
              Research starts with trust
            </p>
            <h2 className="mt-6 max-w-md font-serif text-4xl leading-tight sm:text-5xl">
              The right data.
              <br />A shared commitment.
            </h2>
            <p className="mt-6 max-w-sm text-sm leading-relaxed text-muted">
              Find research datasets, work directly with data providers, and
              track every step from request to delivery.
            </p>
            <ol className="mt-10 space-y-4 text-sm text-muted">
              <li>01 — Create your account</li>
              <li>02 — Set up your workspace</li>
              <li>03 — Start researching or share your data</li>
            </ol>
          </div>
          <p className="text-xs text-muted">
            MedData Escrow · Researcher & data provider workspaces
          </p>
        </aside>
        <section className="px-6 py-12 sm:px-12 lg:py-24">
          <div className="mx-auto max-w-md">
            <p className="font-mono text-xs tracking-widest text-pp-600 uppercase dark:text-pp-400">
              {step}
            </p>
            <h1 className="mt-4 font-serif text-4xl">{title}</h1>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              {description}
            </p>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
