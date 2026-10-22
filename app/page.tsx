/* eslint-disable @next/next/no-img-element */
// MedData Escrow landing page. Server component, no client JS.
// Tailwind v4 + Hanken Grotesk, single PayPal-blue accent on zinc, auto dark mode.

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

// `src` overrides the Simple Icons CDN; it no longer serves any AWS mark, so
// AWS uses a neutral local cloud glyph instead of a 404.
const TOOLS: Array<{ slug: string; label: string; src?: string }> = [
  { slug: "paypal", label: "PayPal" },
  { slug: "aws", label: "AWS", src: "/cloud.svg" },
  { slug: "anthropic", label: "Anthropic Claude" },
  { slug: "nextdotjs", label: "Next.js" },
];

export default function Home() {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Ambient accent glow + faint grid behind the hero */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(60%_60%_at_78%_-10%,rgba(0,112,224,0.15),transparent_70%)]"
      />
      <div
        aria-hidden
        className="hero-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px]"
      />

      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/75 backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/70">
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 font-semibold tracking-tight"
          >
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-pp-600 text-white shadow-sm shadow-pp-600/30">
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
            className="rounded-full bg-pp-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-pp-600/30 transition-all hover:bg-pp-500 hover:shadow-md hover:shadow-pp-600/30 active:translate-y-px"
          >
            Browse datasets
          </Link>
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24 lg:pb-28">
        <div className="reveal">
          <span className="inline-flex items-center gap-2 rounded-full border border-pp-200 bg-pp-50 px-3 py-1 text-xs font-medium text-pp-700 dark:border-pp-500/30 dark:bg-pp-500/10 dark:text-pp-300">
            <ShieldCheck className="h-3.5 w-3.5" />
            PayPal-protected data procurement
          </span>
          <h1 className="mt-5 text-[2.75rem] font-bold leading-[1.02] tracking-[-0.03em] md:text-[3.5rem] lg:text-[4rem]">
            Research data you can trust,{" "}
            <span className="text-pp-600 dark:text-pp-400">
              paid for only once it is delivered.
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-zinc-600 dark:text-zinc-400">
            MedData Escrow matches your study to vetted datasets and holds
            payment in PayPal until the delivery is confirmed.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/researcher"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-pp-600 px-6 font-medium text-white shadow-lg shadow-pp-600/25 transition-all hover:bg-pp-500 hover:shadow-xl hover:shadow-pp-600/30 active:translate-y-px"
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
          {/* proof row — the escrow guarantees in one line, no vanity metrics */}
          <dl className="mt-9 flex flex-wrap gap-x-7 gap-y-3 text-sm">
            {[
              "Funds held, not captured",
              "48-hour confirmation window",
              "Void on a failed sample",
            ].map((fact) => (
              <div key={fact} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-pp-600 dark:text-pp-400" />
                <dt className="text-zinc-600 dark:text-zinc-400">{fact}</dt>
              </div>
            ))}
          </dl>
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
            <span className="inline-flex items-center gap-1.5 rounded-full border border-pp-300 bg-pp-50 px-2.5 py-1 font-mono text-[0.7rem] font-medium text-pp-700 dark:border-pp-500/40 dark:bg-pp-500/10 dark:text-pp-300">
              <span className="held-dot h-1.5 w-1.5 rounded-full bg-pp-500" />
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
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-pp-500" />
              <span className="h-[3px] flex-1 rounded-full bg-gradient-to-r from-pp-500 to-pp-500/25 dark:from-pp-400 dark:to-pp-400/20" />
              <span className="held-dot h-2.5 w-2.5 shrink-0 rounded-full border-2 border-pp-400 bg-white dark:bg-zinc-950" />
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
                          ? "bg-pp-600 text-white"
                          : row.held
                            ? "bg-pp-50 text-pp-700 dark:bg-pp-500/10 dark:text-pp-300"
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
                src={t.src ?? `https://cdn.simpleicons.org/${t.slug}`}
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

      {/* How it works — a lifecycle timeline that rhymes with the hero ledger */}
      <section
        id="how"
        className="mx-auto grid max-w-6xl gap-12 px-5 py-20 lg:grid-cols-[0.85fr_1.15fr] lg:py-28"
      >
        <div className="lg:sticky lg:top-24 lg:self-start">
          <h2 className="text-3xl font-bold tracking-tight md:text-4xl">
            From a plain-English request to a paid-out vendor.
          </h2>
          <p className="mt-5 max-w-sm text-zinc-600 dark:text-zinc-400">
            Six states, one honest rule: the money moves last. Each step is a
            real transition in the escrow machine.
          </p>
        </div>

        <ol className="relative">
          {/* connecting spine behind the nodes */}
          <span
            aria-hidden
            className="absolute left-[15px] top-2 bottom-8 w-px bg-gradient-to-b from-pp-300 via-zinc-200 to-transparent dark:from-pp-500/50 dark:via-zinc-800"
          />
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="relative grid grid-cols-[32px_1fr] gap-x-5 pb-10 last:pb-0"
            >
              <span className="z-10 grid h-8 w-8 place-items-center rounded-full border border-pp-300 bg-white font-mono text-xs font-medium text-pp-700 shadow-sm dark:border-pp-500/40 dark:bg-zinc-950 dark:text-pp-300">
                {s.n}
              </span>
              <div className="pt-1">
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
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
                className="bg-white p-6 transition-colors hover:bg-pp-50/50 dark:bg-zinc-950 dark:hover:bg-pp-500/5"
              >
                <dt className="flex items-center gap-2 font-semibold">
                  <Check className="h-4 w-4 text-pp-600 dark:text-pp-400" />
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
        <div className="group rounded-2xl border border-zinc-200 p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:border-pp-300 hover:shadow-lg hover:shadow-pp-600/5 dark:border-zinc-800 dark:hover:border-pp-500/40">
          <h3 className="text-xl font-semibold">For researchers</h3>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Describe a study, compare ranked matches, and buy access with
            payment protected end to end.
          </p>
          <Link
            href="/researcher"
            className="mt-6 inline-flex items-center gap-1.5 font-medium text-pp-700 hover:underline dark:text-pp-400"
          >
            Open the researcher workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
        <div className="group rounded-2xl border border-zinc-200 p-8 shadow-sm transition-all hover:-translate-y-0.5 hover:border-pp-300 hover:shadow-lg hover:shadow-pp-600/5 dark:border-zinc-800 dark:hover:border-pp-500/40">
          <h3 className="text-xl font-semibold">For vendors</h3>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            List datasets, deliver on demand, and get paid out as soon as the
            buyer confirms the sample.
          </p>
          <Link
            href="/vendor"
            className="mt-6 inline-flex items-center gap-1.5 font-medium text-pp-700 hover:underline dark:text-pp-400"
          >
            Open the vendor workspace
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </section>

      {/* Final CTA — a confident PayPal-blue band to close */}
      <section className="px-5 py-16 lg:py-24">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-gradient-to-br from-pp-600 to-pp-900 px-8 py-16 shadow-xl shadow-pp-900/25 sm:px-12 lg:py-20">
          {/* layered radial sheen for depth, not a flat fill */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_120%_at_85%_-10%,rgba(255,255,255,0.22),transparent_60%)]"
          />
          <ShieldCheck
            aria-hidden
            className="pointer-events-none absolute -right-8 -bottom-10 h-56 w-56 text-white/10"
          />
          <div className="relative flex flex-col items-start gap-7 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">
                Start with a dataset request.
              </h2>
              <p className="mt-3 max-w-md text-pp-50/90">
                Describe your study and let the escrow do the trusting — free to
                try, no keys, no card.
              </p>
            </div>
            <Link
              href="/researcher"
              className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-full bg-white px-7 font-semibold text-pp-700 shadow-lg shadow-pp-900/20 transition-all hover:bg-pp-50 active:translate-y-px"
            >
              Browse datasets
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
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
