// Site navigation shared by the landing page and both workspaces: a vertical
// rail on wide screens, a slim top bar on small ones. Pages offset their
// content with `lg:pl-[72px]` to clear the rail.

import Link from "next/link";
import { ShieldCheck } from "./icons";

export const NAV: Array<{ href: string; label: string }> = [
  { href: "/", label: "Home" },
  { href: "/researcher", label: "Researchers" },
  { href: "/vendor", label: "Vendors" },
  { href: "/#how", label: "How it works" },
];

export default function SiteNav({ current }: { current: string }) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[72px] flex-col items-center justify-between border-r border-rule bg-paper py-8 lg:flex">
        <Link href="/" aria-label="MedData Escrow home">
          <ShieldCheck className="h-6 w-6" />
        </Link>
        <nav className="flex flex-col items-center gap-9 text-sm text-muted">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="rotate-180 transition-colors [writing-mode:vertical-rl] hover:text-ink aria-[current=page]:text-ink"
              aria-current={n.href === current ? "page" : undefined}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="rotate-180 font-mono text-[0.7rem] text-muted [writing-mode:vertical-rl]">
          &rsquo;26
        </span>
      </aside>

      <header className="sticky top-0 z-40 border-b border-rule bg-paper/85 backdrop-blur lg:hidden">
        <nav className="flex h-14 items-center justify-between px-5">
          <Link href="/" className="inline-flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            <span className="text-sm">MedData Escrow</span>
          </Link>
          <div className="flex gap-5 text-sm text-muted">
            {NAV.slice(1, 3).map((n) => (
              <Link
                key={n.label}
                href={n.href}
                className="hover:text-ink aria-[current=page]:text-ink"
                aria-current={n.href === current ? "page" : undefined}
              >
                {n.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
    </>
  );
}
