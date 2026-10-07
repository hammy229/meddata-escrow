/* eslint-disable @next/next/no-img-element */
// MedData Escrow landing page. Server component, no client JS.
// Tailwind v4 + Geist, single emerald accent on zinc, auto dark mode.

import Link from "next/link";

const FLOW = ["MATCHED", "AUTHORIZED", "DELIVERED", "CAPTURED", "PAID_OUT"];

const STEPS: Array<{ n: string; title: string; body: string }> = [
  { n: "01", title: "Describe your study", body: "Say what you need in plain English. No schema wrangling, no sales calls." },
  { n: "02", title: "AI matches datasets", body: "Claude on Bedrock ranks vetted datasets by how well they fit the research need." },
  { n: "03", title: "Authorize payment", body: "Funds are held in escrow through PayPal. Nothing leaves your account yet." },
  { n: "04", title: "Receive delivery", body: "A secure, time-limited download link lands the moment the vendor ships." },
  { n: "05", title: "Confirm within 48h", body: "Happy with the sample? Capture releases the held funds to the vendor." },
  { n: "06", title: "Vendor is paid out", body: "Or, if the sample fails, the authorization is voided and you are not charged." },
];

const TOOLS: Array<{ slug: string; label: string }> = [
  { slug: "paypal", label: "PayPal" },
  { slug: "amazonwebservices", label: "AWS" },
  { slug: "anthropic", label: "Anthropic Claude" },
  { slug: "nextdotjs", label: "Next.js" },
];

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/80 backdrop-blur dark:border-zinc-800/70 dark:bg-zinc-950/80">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" className="font-semibold tracking-tight">
            MedData<span className="text-emerald-600 dark:text-emerald-400"> Escrow</span>
          </Link>
          <div className="hidden items-center gap-7 text-sm text-zinc-600 dark:text-zinc-400 md:flex">
            <a href="#how" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">How it works</a>
            <Link href="/researcher" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">For researchers</Link>
            <Link href="/vendor" className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100">For vendors</Link>
          </div>
          <Link
            href="/researcher"
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500 active:translate-y-px"
          >
            Browse datasets
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-28">
        <div>
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight md:text-5xl lg:text-6xl">
            Research data you can trust, paid for only once it is delivered.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            MedData Escrow matches your study to vetted datasets and holds payment in PayPal until the delivery is confirmed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/researcher"
              className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-600 px-6 font-medium text-white transition-colors hover:bg-emerald-500 active:translate-y-px"
            >
              Browse datasets
            </Link>
            <Link
              href="/vendor"
              className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-300 px-6 font-medium text-zinc-900 transition-colors hover:border-zinc-400 hover:bg-zinc-50 active:translate-y-px dark:border-zinc-700 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            >
              List a dataset
            </Link>
          </div>
        </div>

        {/* Escrow state pipeline (the real product states, not a mockup) */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-6 dark:border-zinc-800 dark:bg-zinc-900/60">
          <p className="mb-5 text-xs font-medium uppercase tracking-wider text-zinc-500">Escrow lifecycle</p>
          <ol className="space-y-2.5">
            {FLOW.map((state, i) => {
              const held = state === "AUTHORIZED" || state === "DELIVERED";
              return (
                <li key={state} className="flex items-center gap-3">
                  <span className="w-5 text-right font-mono text-xs text-zinc-400">{i + 1}</span>
                  <span
                    className={[
                      "flex-1 rounded-lg border px-4 py-2.5 font-mono text-sm",
                      held
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                        : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
                    ].join(" ")}
                  >
                    {state}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-5 text-sm text-zinc-500">
            Funds are <span className="text-emerald-600 dark:text-emerald-400">held</span> from authorization until
            delivery is confirmed. A failed sample voids the hold instead of capturing it.
          </p>
        </div>
      </section>

      {/* Built with */}
      <section className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-10 gap-y-6 px-5 py-8">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Built with</span>
          {TOOLS.map((t) => (
            <img
              key={t.slug}
              src={`https://cdn.simpleicons.org/${t.slug}/71717a`}
              alt={t.label}
              width={22}
              height={22}
              className="h-5 w-auto opacity-80"
            />
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <h2 className="max-w-2xl text-3xl font-semibold tracking-tight md:text-4xl">
          From a plain-English request to a paid-out vendor.
        </h2>
        <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="border-t border-zinc-200 pt-5 dark:border-zinc-800">
              <div className="font-mono text-sm text-emerald-600 dark:text-emerald-400">{s.n}</div>
              <h3 className="mt-2 text-lg font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust / why escrow */}
      <section className="border-t border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">
              Neither side has to trust the other first.
            </h2>
            <p className="mt-5 max-w-lg text-zinc-600 dark:text-zinc-400">
              Payment is authorized up front but captured only after the buyer confirms the sample. The vendor knows the
              money is real before shipping. The buyer never pays for data that does not arrive.
            </p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 dark:border-zinc-800 dark:bg-zinc-800">
            {[
              { t: "Authorize, then capture", d: "PayPal Orders v2 holds the funds. Capture happens on delivery, void on failure." },
              { t: "48-hour confirmation window", d: "Inside PayPal's honor period. Lapsed windows auto-capture; stale holds reauthorize." },
              { t: "Webhooks are the source of truth", d: "Every state change verifies a signed PayPal webhook before it is trusted." },
            ].map((row) => (
              <div key={row.t} className="bg-white p-6 dark:bg-zinc-950">
                <dt className="font-medium">{row.t}</dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{row.d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Two audiences */}
      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-20 md:grid-cols-2 lg:py-28">
        <div className="rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
          <h3 className="text-xl font-semibold">For researchers</h3>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Describe a study, compare ranked matches, and buy access with payment protected end to end.
          </p>
          <Link href="/researcher" className="mt-6 inline-flex font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            Open the researcher workspace →
          </Link>
        </div>
        <div className="rounded-2xl border border-zinc-200 p-8 dark:border-zinc-800">
          <h3 className="text-xl font-semibold">For vendors</h3>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            List datasets, deliver on demand, and get paid out as soon as the buyer confirms the sample.
          </p>
          <Link href="/vendor" className="mt-6 inline-flex font-medium text-emerald-700 hover:underline dark:text-emerald-400">
            Open the vendor workspace →
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Start with a dataset request.</h2>
          <Link
            href="/researcher"
            className="inline-flex h-12 items-center justify-center rounded-full bg-emerald-600 px-6 font-medium text-white transition-colors hover:bg-emerald-500 active:translate-y-px"
          >
            Browse datasets
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>MedData Escrow · PayPal AI Hackathon 2026</span>
          <div className="flex gap-6">
            <a href="#how" className="hover:text-zinc-900 dark:hover:text-zinc-200">How it works</a>
            <a
              href="https://github.com/hammy229/meddata-escrow"
              className="hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
