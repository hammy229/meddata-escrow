"use client";

// A small pill pinned to the corner, shown only when the server reports mock
// mode (GET /api/health -> { mode: "mock" }). It says no real money moves and
// offers a one-click demo reset: POST /api/demo/reset, clear this browser's
// session storage (the researcher's saved view lives there), then reload.
// In live mode the health check says so and nothing is rendered.
import { useEffect, useState } from "react";

export default function DemoBar() {
  const [mock, setMock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((res) => res.json())
      .then((json: { mode?: string }) => {
        if (!cancelled) setMock(json.mode === "mock");
      })
      .catch(() => {
        // Health unreachable: stay hidden rather than guess the mode.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mock) return null;

  async function reset(withStory: boolean) {
    if (
      !window.confirm(
        withStory
          ? "Reset the demo and add sample orders? This deletes every current order, agent run and query charge."
          : "Reset the demo? This deletes every order, agent run and query charge.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/reset", {
        method: "POST",
        ...(withStory
          ? {
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ seed: "story" }),
            }
          : {}),
      });
      if (!res.ok) throw new Error(`reset failed (${res.status})`);
      try {
        window.sessionStorage.clear();
      } catch {
        // Storage blocked: nothing saved to clear.
      }
      window.location.reload();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      role="status"
      className="fixed bottom-3 right-3 z-50 flex items-center gap-3 rounded-full border border-rule bg-paper px-4 py-1.5 text-xs text-muted shadow-sm"
    >
      <span>Mock mode: no real money moves</span>
      <button
        type="button"
        onClick={() => reset(false)}
        disabled={busy}
        className="border-l border-rule pl-3 text-ink underline-offset-2 hover:underline disabled:opacity-50"
      >
        {busy ? "Resetting…" : "Reset"}
      </button>
      <button
        type="button"
        onClick={() => reset(true)}
        disabled={busy}
        className="text-ink underline-offset-2 hover:underline disabled:opacity-50"
      >
        Reset with sample orders
      </button>
      {error ? <span className="text-ink">{error}</span> : null}
    </div>
  );
}
