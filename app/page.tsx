// MedData Escrow landing page. Server component, no client JS.
// Editorial layout: Spectral headlines, Inter Tight body, hairline rules on
// warm paper, one PayPal-blue accent, auto dark mode.

import Link from "next/link";

// The real product states, in order, each with a one-line plain meaning.
// AUTHORIZED is the "current" state the hero order is frozen at.
const FLOW: Array<{ state: string; held: boolean; note: string }> = [
  {
    state: "MATCHED",
    held: false,
    note: "AI ranked this dataset to the study",
  },
  {
    state: "AUTHORIZED",
    held: true,
    note: "PayPal holds the funds — none captured",
  },
  {
    state: "DELIVERED",
    held: true,
    note: "Secure download link ships to the buyer",
  },
  {
    state: "CAPTURED",
    held: false,
    note: "Buyer confirms — the held funds release",
  },
  {
    state: "PAID_OUT",
    held: false,
    note: "Vendor is paid; a failed sample voids",
  },
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

const NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/researcher", label: "Researchers" },
  { href: "/vendor", label: "Vendors" },
  { href: "#how", label: "How it works" },
];

const AUDIENCES: Array<{ label: string; title: string; body: string }> = [
  {
    label: "For researchers",
    title: "Ask in English. Pay on arrival.",
    body: "Describe a study, compare ranked matches, and only pay once the data shows up and the sample checks out.",
  },
  {
    label: "For vendors",
    title: "Real money before you ship.",
    body: "The buyer's funds are already held in PayPal, so you deliver knowing the payment exists.",
  },
  {
    label: "For both sides",
    title: "No one trusts first.",
    body: "Capture waits for the buyer's confirmation. A failed sample voids the hold and nobody is charged.",
  },
];

const GUARANTEES: Array<{ t: string; d: string }> = [
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
];

// Shared text-link style: underlined label + arrow, no button chrome.
const TEXT_LINK =
  "group inline-flex items-center gap-1 border-b border-ink pb-0.5 text-[0.95rem] text-ink transition-colors hover:border-pp-600 hover:text-pp-600 dark:hover:border-pp-400 dark:hover:text-pp-400";

export default function Home() {
  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-paper text-ink">
      {/* Vertical rail nav on wide screens */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center justify-between border-r border-rule bg-paper py-8 lg:flex">
        <Link href="/" aria-label="MedData Escrow home">
          <Mark className="h-6 w-6" />
        </Link>
        <nav className="flex flex-col items-center gap-9 text-sm text-muted">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="[writing-mode:vertical-rl] rotate-180 transition-colors hover:text-ink aria-[current=page]:text-ink"
              aria-current={n.href === "/" ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="[writing-mode:vertical-rl] rotate-180 font-mono text-[0.7rem] text-muted">
          &rsquo;26
        </span>
      </aside>

      {/* Top bar on small screens */}
      <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur lg:hidden">
        <nav className="flex h-14 items-center justify-between px-5">
          <Link href="/" className="inline-flex items-center gap-2">
            <Mark className="h-5 w-5" />
            <span className="text-sm">MedData Escrow</span>
          </Link>
          <div className="flex gap-5 text-sm text-muted">
            <Link href="/researcher" className="hover:text-ink">
              Researchers
            </Link>
            <Link href="/vendor" className="hover:text-ink">
              Vendors
            </Link>
          </div>
        </nav>
      </header>

      <main className="lg:pl-[72px]">
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pt-16 pb-24 sm:px-10 lg:grid-cols-[1.1fr_1fr] lg:pt-28 lg:pb-36">
          <div className="reveal">
            <h1 className="font-serif text-[3rem] leading-[1.04] font-normal sm:text-[4rem] lg:text-[4.75rem]">
              Medical research data, paid for once it arrives.
            </h1>
            <p className="mt-8 max-w-md text-[1.05rem] leading-relaxed font-light text-muted">
              We match your study to vetted datasets and hold the payment in
              PayPal until you confirm the delivery.
            </p>
            <div className="mt-10 flex flex-wrap gap-8">
              <Link href="/researcher" className={TEXT_LINK}>
                Browse datasets
                <span className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
              <Link href="/vendor" className={TEXT_LINK}>
                List a dataset
                <span className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
            </div>
          </div>

          <DatasetField />
        </section>

        {/* Statement */}
        <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-10 lg:pb-36">
          <p className="max-w-4xl font-serif text-[1.85rem] leading-[1.3] font-light sm:text-[2.4rem]">
            MedData Escrow sits between the lab and the data vendor. Claude
            reads the study request, ranks the datasets that fit, and PayPal
            holds the money &mdash; so the vendor knows it&rsquo;s real and the
            buyer never pays for data that doesn&rsquo;t show up.
          </p>
        </section>

        {/* Audiences: three columns split by hairlines */}
        <section className="border-t border-rule">
          <div className="mx-auto grid max-w-6xl px-5 py-20 sm:px-10 md:grid-cols-3 lg:py-28">
            {AUDIENCES.map((a, i) => (
              <div
                key={a.label}
                className={[
                  "py-6 md:py-0",
                  i > 0
                    ? "border-t border-rule md:border-t-0 md:border-l md:pl-8"
                    : "",
                  i < AUDIENCES.length - 1 ? "md:pr-8" : "",
                ].join(" ")}
              >
                <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                  {a.label}
                </p>
                <h3 className="mt-4 font-serif text-[1.4rem] font-normal">
                  {a.title}
                </h3>
                <p className="mt-3 text-[0.95rem] leading-relaxed font-light text-muted">
                  {a.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works: numbered steps beside the live escrow states */}
        <section id="how" className="border-t border-rule">
          <div className="mx-auto grid max-w-6xl gap-16 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_1fr] lg:py-28">
            <div>
              <p className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                How it works
              </p>
              <h2 className="mt-4 font-serif text-[2.2rem] leading-tight font-normal sm:text-[2.75rem]">
                The money moves last.
              </h2>
              <ol className="mt-10">
                {STEPS.map((s) => (
                  <li
                    key={s.n}
                    className="grid grid-cols-[2.5rem_1fr] gap-x-4 border-t border-rule py-5"
                  >
                    <span className="pt-1 font-mono text-xs text-muted">
                      {s.n}
                    </span>
                    <div>
                      <h3 className="text-[1.02rem] font-medium tracking-normal">
                        {s.title}
                      </h3>
                      <p className="mt-1 text-[0.92rem] leading-relaxed font-light text-muted">
                        {s.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* The real escrow states, one order frozen at AUTHORIZED */}
            <div className="lg:sticky lg:top-16 lg:self-start">
              <div className="flex items-baseline justify-between border-b border-ink pb-3">
                <span className="font-mono text-[0.7rem] tracking-[0.18em] text-muted uppercase">
                  Order MD-4821
                </span>
                <span className="inline-flex items-center gap-2 font-mono text-[0.7rem] tracking-[0.18em] text-pp-600 uppercase dark:text-pp-400">
                  <span className="held-dot h-1.5 w-1.5 rounded-full bg-pp-600 dark:bg-pp-400" />
                  Funds held
                </span>
              </div>
              <p className="mt-6 text-sm font-light text-muted">
                De-identified cardiology cohort
              </p>
              <p className="mt-1 font-serif text-5xl font-light tabular-nums">
                $4,200<span className="text-muted">.00</span>
              </p>
              <ol className="mt-8">
                {FLOW.map((row, i) => {
                  const current = row.state === "AUTHORIZED";
                  return (
                    <li
                      key={row.state}
                      className="grid grid-cols-[1.5rem_8.5rem_1fr] items-baseline gap-x-3 border-t border-rule py-3"
                    >
                      <span className="font-mono text-[0.7rem] text-muted">
                        {i + 1}
                      </span>
                      <span
                        className={[
                          "font-mono text-xs",
                          current
                            ? "text-pp-600 dark:text-pp-400"
                            : row.held
                              ? "text-ink"
                              : "text-muted",
                        ].join(" ")}
                      >
                        {current ? "\u2192 " : ""}
                        {row.state}
                      </span>
                      <span className="text-[0.85rem] font-light text-muted">
                        {row.note}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>

        {/* Guarantees */}
        <section className="border-t border-rule">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-10 lg:grid-cols-[1fr_1.4fr] lg:py-28">
            <h2 className="font-serif text-[2.2rem] leading-tight font-normal sm:text-[2.75rem]">
              Neither side has to trust the other first.
            </h2>
            <dl>
              {GUARANTEES.map((g) => (
                <div
                  key={g.t}
                  className="border-t border-rule py-6 first:border-t-0 first:pt-0"
                >
                  <dt className="font-serif text-[1.3rem]">{g.t}</dt>
                  <dd className="mt-2 text-[0.95rem] leading-relaxed font-light text-muted">
                    {g.d}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Closing line */}
        <section className="border-t border-rule">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-20 sm:px-10 md:flex-row md:items-end md:justify-between lg:py-28">
            <h2 className="max-w-xl font-serif text-[2.2rem] leading-tight font-normal sm:text-[2.75rem]">
              Start with a dataset request.
            </h2>
            <div className="flex flex-wrap gap-8">
              <Link href="/researcher" className={TEXT_LINK}>
                Open the researcher workspace
                <span className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
              <Link href="/vendor" className={TEXT_LINK}>
                Open the vendor workspace
                <span className="transition-transform group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t border-rule">
          <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 text-sm font-light text-muted sm:px-10 md:grid-cols-3 md:items-start">
            <div>
              <span className="inline-flex items-center gap-2 font-normal text-ink">
                <Mark className="h-4 w-4" />
                MedData Escrow
              </span>
              <p className="mt-2">
                Research data, held in escrow until it arrives.
              </p>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 md:justify-center">
              {NAV.map((n) => (
                <Link key={n.label} href={n.href} className="hover:text-ink">
                  {n.label}
                </Link>
              ))}
              <a
                href="https://github.com/hammy229/meddata-escrow"
                className="hover:text-ink"
              >
                GitHub
              </a>
            </div>
            <div className="md:text-right">
              <p>Built with PayPal, AWS Bedrock, Claude, and Next.js</p>
              <p className="mt-1">PayPal AI Hackathon 2026</p>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}

// Hero illustration: a field of datasets fading from solid to outline, with
// the one the AI matched (and whose funds are held) picked out in blue.
function DatasetField() {
  const rows = [4, 5, 4, 5];
  const MATCH = { r: 2, c: 1 };
  return (
    <figure className="reveal relative mx-auto w-full max-w-[460px] [animation-delay:120ms]">
      <div
        aria-hidden
        className="dataset-grid pointer-events-none absolute -inset-10"
      />
      <div className="relative flex flex-col items-center gap-7 py-8">
        {rows.map((count, r) => (
          <div key={r} className="flex gap-9">
            {Array.from({ length: count }, (_, c) => {
              const match = r === MATCH.r && c === MATCH.c;
              // solid in the first row, fading to outlines further down
              const fill = Math.max(0, 1 - (r * 5 + c) / 11);
              return (
                <Cylinder
                  key={c}
                  fill={match ? 0 : fill}
                  className={
                    match
                      ? "h-9 w-8 text-pp-600 dark:text-pp-400"
                      : "h-9 w-8 text-ink"
                  }
                />
              );
            })}
          </div>
        ))}
      </div>
      <figcaption className="relative mt-2 text-center font-mono text-[0.7rem] tracking-[0.14em] text-muted uppercase">
        18 datasets &middot; 1 match &middot; funds held
      </figcaption>
    </figure>
  );
}

function Cylinder({ fill, className }: { fill: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 32 36"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
      aria-hidden
    >
      <path
        d="M4 7v22c0 2.8 5.4 5 12 5s12-2.2 12-5V7"
        fill="currentColor"
        fillOpacity={fill * 0.85}
      />
      <ellipse
        cx="16"
        cy="7"
        rx="12"
        ry="5"
        fill="currentColor"
        fillOpacity={fill}
      />
      <path d="M4 18c0 2.8 5.4 5 12 5s12-2.2 12-5" />
    </svg>
  );
}

// The MedData mark: a shield with a check, drawn at one stroke weight.
function Mark({ className }: { className?: string }) {
  return <ShieldCheck className={className} />;
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
