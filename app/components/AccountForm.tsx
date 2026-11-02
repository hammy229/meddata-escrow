"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Role } from "../../lib/auth/store";
const input =
  "mt-2 w-full rounded-[3px] border border-rule bg-paper px-4 py-3 text-sm outline-none focus:border-pp-500 focus:ring-2 focus:ring-pp-500/15";
export default function AccountForm({
  mode,
  initialRole = "researcher",
  initial,
}: {
  mode: "login" | "signup" | "setup";
  initialRole?: Role;
  initial?: { organization: string; purpose: string; payout_email: string };
}) {
  const router = useRouter();
  const [role, setRole] = useState<Role>(initialRole);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...data, role }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Something went wrong");
      try {
        if (mode !== "setup")
          sessionStorage.removeItem("meddata:researcher-resume");
      } catch {
        /* Storage may be disabled by the browser. */
      }
      router.replace(json.redirect);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to connect. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="mt-10 space-y-6">
      {mode === "signup" && (
        <fieldset>
          <legend className="mb-3 text-sm">How will you use MedData?</legend>
          <div className="grid grid-cols-2 gap-3">
            {(["researcher", "vendor"] as const).map((value) => (
              <label
                key={value}
                className={`cursor-pointer rounded-[3px] border p-4 text-sm ${role === value ? "border-pp-600 bg-pp-500/5" : "border-rule"}`}
              >
                <input
                  type="radio"
                  name="accountRole"
                  value={value}
                  checked={role === value}
                  onChange={() => setRole(value)}
                  className="mr-2"
                />
                {value === "researcher" ? "Researcher" : "Data provider"}
                <span className="mt-2 block text-xs leading-relaxed text-muted">
                  {value === "researcher"
                    ? "Find data for your next study."
                    : "List datasets and manage delivery."}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {mode === "signup" && (
        <label className="block text-sm">
          Full name
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
            className={input}
          />
        </label>
      )}
      {mode !== "setup" && (
        <>
          <label className="block text-sm">
            Work email
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              maxLength={254}
              className={input}
            />
          </label>
          <label className="block text-sm">
            Password
            <input
              type="password"
              name="password"
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              required
              minLength={12}
              maxLength={128}
              className={input}
            />
            {mode === "signup" && (
              <span className="mt-2 block text-xs text-muted">
                Use at least 12 characters.
              </span>
            )}
          </label>
        </>
      )}
      {mode === "setup" && (
        <>
          <label className="block text-sm">
            {role === "researcher"
              ? "Institution or organization"
              : "Organization name"}
            <input
              name="organization"
              autoComplete="organization"
              defaultValue={initial?.organization}
              required
              minLength={2}
              maxLength={200}
              className={input}
            />
          </label>
          <label className="block text-sm">
            {role === "researcher"
              ? "What are you researching?"
              : "What data does your organization provide?"}
            <textarea
              name="purpose"
              defaultValue={initial?.purpose}
              required
              minLength={10}
              maxLength={2000}
              rows={4}
              placeholder={
                role === "researcher"
                  ? "Describe your field, study, and the data you need."
                  : "Describe your datasets, coverage, and permitted research uses."
              }
              className={input}
            />
          </label>
          {role === "vendor" && (
            <label className="block text-sm">
              PayPal payout email
              <input
                name="payoutEmail"
                type="email"
                defaultValue={initial?.payout_email}
                required
                maxLength={254}
                className={input}
              />
              <span className="mt-2 block text-xs leading-relaxed text-muted">
                The PayPal account that receives your dataset payments. This
                saves your payout address; it does not connect a database.
              </span>
            </label>
          )}
          <label className="flex items-start gap-3 text-sm leading-relaxed text-muted">
            <input type="checkbox" required className="mt-1" />
            {role === "researcher"
              ? "I will use data only for permitted research and will not attempt to identify individuals."
              : "I have permission to provide this data and will list only synthetic or appropriately de-identified datasets."}
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-300">
          {error}
        </p>
      )}
      <button
        disabled={busy}
        className="w-full rounded-[3px] bg-ink px-5 py-3 text-sm text-paper transition-colors hover:bg-pp-600 disabled:opacity-50"
      >
        {busy
          ? "Please wait…"
          : mode === "login"
            ? "Sign in"
            : mode === "signup"
              ? "Create account"
              : "Save and open workspace"}
        <span aria-hidden className="ml-2">
          →
        </span>
      </button>
      {mode !== "setup" && (
        <p className="text-center text-sm text-muted">
          {mode === "login" ? "New to MedData? " : "Already have an account? "}
          <Link
            href={`${mode === "login" ? "/signup" : "/login"}?role=${role}`}
            className="text-ink underline underline-offset-4"
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </Link>
        </p>
      )}
    </form>
  );
}
