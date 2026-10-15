/* eslint-disable @next/next/no-img-element */
// MedData Escrow landing page. Server component, no client JS.
// Tailwind v4 + Hanken Grotesk, single emerald accent on zinc, auto dark mode.

import Link from "next/link";

// The real product states, in order, each with a one-line plain meaning.
// AUTHORIZED is the "current" state the hero order is frozen at.
const FLOW: Array<{ state: string; held: boolean; note: string }> = [
  { state: "MATCHED", held: false, note: "AI ranked this dataset to the study" },
  { state: "AUTHORIZED", held: true, note: "PayPal holds the funds — none captured" },
  { state: "DELIVERED", held: true, note: "Secure download link ships to the buyer" },
  { state: "CAPTURED", held: false, note: "Buyer confirms — the held funds release" },
  { state: "PAID_OUT", held: false, note: "Vendor is paid; a failed sample voids" },
];

const STEPS: Array<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "Describe your study",
    body: "Say what you need in plain English. No schema wrangling, no sales calls.",
  },
  {
    n: "02",
    title: "AI matches datasets",
    body: "Claude on Bedrock ranks vetted datasets by how well they fit the research need.",
  },
  {
    n: "03",
    title: "Authorize payment",
    body: "Funds are held in escrow through PayPal. Nothing leaves your account yet.",
  },
  {
    n: "04",
    title: "Receive delivery",
    body: "A secure, time-limited download link lands the moment the vendor ships.",
  },
  {
    n: "05",
    title: "Confirm within 48h",
    body: "Happy with the sample? Capture releases the held funds to the vendor.",
  },
  {
    n: "06",
    title: "Vendor is paid out",
    body: "Or, if the sample fails, the authorization is voided and you are not charged.",
  },
];

const TOOLS: Array<{ slug: string; label: string }> = [
  { slug: "paypal", label: "PayPal" },
  { slug: "amazonwebservices", label: "AWS" },
  { slug: "anthropic", label: "Anthropic Claude" },
  { slug: "nextdotjs", label: "Next.js" },
];

export default function Home() {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Ambient accent glow behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(60%_60%_at_78%_-10%,rgba(16,185,129,0.14),transparent_70%)]"
      />

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/75 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/70">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white shadow-sm shadow-emerald-600/30">
              <ShieldCheck className="h-[18px] w-[18px]" />
            </span>
            MedData
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              Escrow
            </span>
          </Link>
          <div className="hidden items-center gap-7 text-sm text-zinc-600 dark:text-zinc-400 md:flex">
            <a
              href="#how"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              How it works
            </a>
            <Link
              href="/researcher"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              For researchers
            </Link>
            <Link
              href="/vendor"
              className="transition-colors hover:text-zinc-900 dark:hover:text-zinc-100"
            >
              For vendors
            </Link>
          </div>
          <Link
            href="/researcher"
            className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-emerald-600/30 transition-all hover:bg-emerald-500 hover:shadow-md hover:shadow-emerald-600/30 active:translate-y-px"
          >
            Browse datasets
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-28">
        <div className="reveal">
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            PayPal-protected data procurement
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-[1.04] tracking-tight md:text-5xl lg:text-6xl">
            Research data you can trust, paid for only once it is delivered.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            MedData Escrow matches your study to vetted datasets and holds
            payment in PayPal until the delivery is confirmed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/researcher"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 font-medium text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-500 hover:shadow-xl hover:shadow-emerald-600/30 active:translate-y-px"
            >
              Browse datasets
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/vendor"
              className="inline-flex h-12 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 font-medium text-zinc-900 shadow-sm transition-all hover:border-zinc-400 hover:bg-zinc-50 active:translate-y-px dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-zinc-800"
            >
              List a dataset
            </Link>
          </div>
        </div>

        {/* Signature visual: a real escrow order frozen in its held state —
            amount, a buyer -> vendor held-funds track, and the live lifecycle.
            The actual product states, not a decorative mockup. */}
        <div className="reveal overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-50/80 shadow-xl shadow-zinc-900/5 backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/60 dark:shadow-black/20 [animation-delay:120ms]">
          {/* order header */}
          <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
            <span className="font-mono text-xs tracking-wide text-zinc-400">
              ESCROW · ORDER #MD-4821
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 font-mono text-[0.7rem] font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300">
              <span className="held-dot h-1.5 w-1.5 rounded-full bg-emerald-500" />
              FUNDS HELD
            </span>
          </div>

          {/* amount + dataset */}
          <div className="px-6 pt-6">
            <p className="text-sm text-zinc-500">
              De-identified cardiology cohort
            </p>
            <p className="mt-1 font-mono text-4xl font-semibold tabular-nums tracking-tight">
              $4,200<span className="text-2xl text-zinc-400">.00</span>
            </p>
          </div>

          {/* held-funds track: authorized ——(held)——→ released on delivery */}
          <div className="px-6 pt-6">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>Buyer authorized</span>
              <span>Vendor, on delivery</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
              <span className="h-[3px] flex-1 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-500/25 dark:from-emerald-400 dark:to-emerald-400/20" />
              <span className="held-dot h-2.5 w-2.5 shrink-0 rounded-full border-2 border-emerald-400 bg-white dark:bg-zinc-950" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              Held in PayPal from authorization. Captured only when the buyer
              confirms the sample — a failed sample voids the hold.
            </p>
          </div>

          {/* lifecycle ledger */}
          <div className="mt-6 border-t border-zinc-200 bg-white/60 px-6 py-5 dark:border-zinc-800 dark:bg-zinc-950/40">
            <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-zinc-500">
              <Lock className="h-3.5 w-3.5" />
              Escrow lifecycle
            </p>
            <ol className="space-y-1">
              {FLOW.map((row, i) => {
                const current = row.state === "AUTHORIZED";
                return (
                  <li key={row.state} className="flex items-center gap-3 py-1">
                    <span className="w-4 text-right font-mono text-[0.7rem] tabular-nums text-zinc-400">
                      {i + 1}
                    </span>
                    <span
                      className={[
                        "rounded-md px-2.5 py-1 font-mono text-xs",
                        current
                          ? "bg-emerald-600 text-white"
                          : row.held
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                            : "text-zinc-500 dark:text-zinc-400",
                      ].join(" ")}
                    >
                      {row.state}
                    </span>
                    <span className="truncate text-xs text-zinc-400 dark:text-zinc-500">
                      {row.note}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </section>

      {/* Built with */}
      <section className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-5 px-5 py-8">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Built with
          </span>
          {TOOLS.map((t) => (
            <span
              key={t.slug}
              className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300"
            >
              <img
                src={`https://cdn.simpleicons.org/${t.slug}`}
                alt=""
                width={16}
                height={16}
                className="h-4 w-4"
              />
              {t.label}
            </span>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl px-5 py-20 lg:py-28">
        <h2 className="max-w-2xl text-3xl font-bold tracking-tight md:text-4xl">
          From a plain-English request to a paid-out vendor.
        </h2>
        <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((s) => (
            <div
              key={s.n}
              className="group border-t border-zinc-200 pt-5 transition-colors hover:border-emerald-400 dark:border-zinc-800 dark:hover:border-emerald-500/60"
            >
              <div className="font-mono text-sm text-emerald-600 dark:text-emerald-400">
                {s.n}
              </div>
              <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                {s.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Trust / why escrow */}
      <section className="border-t border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-2 lg:py-28">
          <div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
              Neither side has to trust the other first.
            </h2>
            <p className="mt-5 max-w-lg text-zinc-600 dark:text-zinc-400">
              Payment is authorized up front but captured only after the buyer
              confirms the sample. The vendor knows the money is real before
              shipping. The buyer never pays for data that does not arrive.
            </p>
          </div>
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-zinc-200 bg-zinc-200 shadow-lg shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-800 dark:shadow-black/20">
            {[
              {
                t: "Authorize, then capture",
                d: "PayPal Orders v2 holds the funds. Capture happens on delivery, void on failure.",
              },
              {
                t: "48-hour confirmation window",
                d: "Inside PayPal's honor period. Lapsed windows auto-capture; stale holds reauthorize.",
              },
              {
                t: "Webhooks are the source of truth",
                d: "Every state change verifies a signed PayPal webhook before it is trusted.",
              },
            ].map((row) => (
              <div
                key={row.t}
                className="bg-white p-6 transition-colors hover:bg-emerald-50/50 dark:bg-zinc-950 dark:hover:bg-emerald-500/5"
              >
                <dt className="flex items-center gap-2 font-semibold">
                  <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  {row.t}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {row.d}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Two audiences */}
      <section className="mx-auto grid max-w-6xl gap-6 px-5 py-20 md:grid-cols-2 lg:py-28">
        <div className="group rounded-2xl border border-zinc-200 p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-600/5 dark:border-zinc-800 dark:hover:border-emerald-500/40">
          <h3 className="text-xl font-semibold">For researchers</h3>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Describe a study, compare ranked matches, and buy access with
            payment protected end to end.
          </p>
          <Link
            href="/researcher"
            className="mt-6 inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Open the researcher workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="group rounded-2xl border border-zinc-200 p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-600/5 dark:border-zinc-800 dark:hover:border-emerald-500/40">
          <h3 className="text-xl font-semibold">For vendors</h3>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            List datasets, deliver on demand, and get paid out as soon as the
            buyer confirms the sample.
          </p>
          <Link
            href="/vendor"
            className="mt-6 inline-flex items-center gap-1.5 font-medium text-emerald-700 hover:underline dark:text-emerald-400"
          >
            Open the vendor workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-5 py-20 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            Start with a dataset request.
          </h2>
          <Link
            href="/researcher"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-emerald-600 px-6 font-medium text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-500 hover:shadow-xl hover:shadow-emerald-600/30 active:translate-y-px"
          >
            Browse datasets
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-10 text-sm text-zinc-500 sm:flex-row sm:items-center sm:justify-between">
          <span>MedData Escrow · PayPal AI Hackathon 2026</span>
          <div className="flex gap-6">
            <a
              href="#how"
              className="hover:text-zinc-900 dark:hover:text-zinc-200"
            >
              How it works
            </a>
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

/* ---- Inline icons: one stroke weight, currentColor, no emoji ---- */
function ShieldCheck({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 3 5 6v5.5c0 4 2.9 7.3 7 8.5 4.1-1.2 7-4.5 7-8.5V6l-7-3Z" />
      <path d="m9 11.8 2.1 2.1L15.2 9.8" />
    </svg>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 12h15" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

function Lock({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
      <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
    </svg>
  );
}

function Check({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m5 12.5 4.5 4.5L19 7" />
    </svg>
  );
}
