"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
export default function AccountMenu({ name }: { name: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error();
      try {
        sessionStorage.removeItem("meddata:researcher-resume");
      } catch {
        /* Storage may be disabled by the browser. */
      }
      router.replace("/login");
      router.refresh();
    } catch {
      setError("Could not sign out. Try again.");
      setBusy(false);
    }
  }
  return (
    <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-rule pb-4 text-sm">
      <span className="mr-auto text-muted">{name}</span>
      <Link href="/setup" className="hover:text-pp-600">
        Account setup
      </Link>
      <button
        onClick={logout}
        disabled={busy}
        className="text-muted hover:text-ink disabled:opacity-50"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <p role="alert" className="w-full text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
