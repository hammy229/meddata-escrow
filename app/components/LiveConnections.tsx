"use client";
import { useEffect, useState } from "react";
interface Connection {
  id: string;
  label: string;
  host: string;
  databaseName: string;
  schemaName: string;
  tableName: string;
  fields: string[];
  testedAt: string;
}
const input =
  "mt-2 w-full rounded-[3px] border border-rule bg-paper px-3 py-2.5 text-sm outline-none focus:border-pp-500";
const button =
  "rounded-[3px] bg-ink px-4 py-2.5 text-sm text-paper hover:bg-pp-600 disabled:opacity-40";
export default function LiveConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function load() {
    const res = await fetch("/api/connections", { cache: "no-store" });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error ?? "Could not load connections");
    setConnections(json.connections);
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/connections", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok)
          throw new Error(json.error ?? "Could not load connections");
        if (!cancelled) setConnections(json.connections);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  async function perform(
    path: string,
    method: string,
    data: unknown,
    success: string,
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch(path, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Request failed");
      await load();
      setMessage(success);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to connect");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (
      await perform(
        "/api/connections",
        "POST",
        Object.fromEntries(new FormData(form)),
        "Connection tested and saved.",
      )
    )
      form.reset();
  }
  async function publish(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = Object.fromEntries(new FormData(form));
    if (
      await perform(
        "/api/datasets",
        "POST",
        {
          ...data,
          priceCents: Math.round(Number(data.price) * 100),
          synthetic: data.synthetic === "on",
        },
        "Dataset published. It will appear in your catalog and researcher matching.",
      )
    ) {
      form.reset();
      window.dispatchEvent(new Event("meddata:catalog-updated"));
    }
  }
  return (
    <section className="border-t border-rule pt-8 pb-10">
      <p className="font-mono text-xs tracking-widest text-muted uppercase">
        Live PostgreSQL
      </p>
      <h2 className="mt-3 font-serif text-[1.6rem]">
        Connect your research data
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
        Use a dedicated database login and a research view containing dataset_id
        and supported research fields. Only aggregate results are returned. This
        application accepts synthetic data.
      </p>
      <details className="mt-6 border border-rule p-5">
        <summary className="cursor-pointer text-sm">
          Add a database connection
        </summary>
        <form onSubmit={connect} className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="text-sm">
            Connection name
            <input
              name="label"
              required
              minLength={2}
              maxLength={100}
              className={input}
              placeholder="Research warehouse"
            />
          </label>
          <label className="text-sm sm:col-span-2">
            PostgreSQL connection URL
            <input
              name="connectionString"
              type="password"
              autoComplete="off"
              required
              className={input}
              placeholder="postgresql://research_reader:password@host/database"
            />
            <span className="mt-2 block text-xs text-muted">
              Saved credentials are encrypted and never displayed. The host must
              be approved in the server’s PROVIDER_DATABASE_HOSTS setting.
            </span>
          </label>
          <label className="text-sm">
            Schema
            <input
              name="schemaName"
              required
              pattern="[a-z_][a-z0-9_]*"
              defaultValue="public"
              className={input}
            />
          </label>
          <label className="text-sm">
            Research view
            <input
              name="tableName"
              required
              pattern="[a-z_][a-z0-9_]*"
              defaultValue="research_records"
              className={input}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            CA certificate (optional)
            <textarea
              name="caCert"
              rows={3}
              className={input}
              placeholder="PEM certificate for a private certificate authority"
            />
          </label>
          <div>
            <button disabled={busy} className={button}>
              {busy ? "Connecting…" : "Test and save connection"}
            </button>
          </div>
        </form>
      </details>
      {connections.map((connection) => (
        <div
          key={connection.id}
          className="mt-4 flex flex-wrap items-center justify-between gap-4 border border-rule p-5"
        >
          <div>
            <h3 className="font-medium">{connection.label}</h3>
            <p className="mt-1 break-all text-xs text-muted">
              {connection.host} · {connection.databaseName} ·{" "}
              {connection.schemaName}.{connection.tableName}
            </p>
            <p className="mt-2 text-xs text-muted">
              Fields: {connection.fields.join(", ") || "count only"} · Last
              tested {new Date(connection.testedAt).toLocaleString()}
            </p>
          </div>
          <div className="flex gap-4">
            <button
              disabled={busy}
              onClick={() =>
                perform(
                  "/api/connections",
                  "POST",
                  { action: "test", connectionId: connection.id },
                  "Connection is available.",
                )
              }
              className="text-sm underline underline-offset-4 disabled:opacity-40"
            >
              Test
            </button>
            <button
              disabled={busy}
              onClick={() =>
                perform(
                  "/api/connections",
                  "DELETE",
                  { connectionId: connection.id },
                  "Unused connection removed.",
                )
              }
              className="text-sm text-muted underline underline-offset-4 disabled:opacity-40"
            >
              Remove unused connection
            </button>
          </div>
        </div>
      ))}
      {connections.length > 0 && (
        <details className="mt-6 border border-rule p-5">
          <summary className="cursor-pointer text-sm">
            Publish a dataset from a connection
          </summary>
          <form onSubmit={publish} className="mt-5 grid gap-5 sm:grid-cols-2">
            <label className="text-sm">
              Connection
              <select name="connectionId" required className={input}>
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Dataset key
              <input
                name="datasetKey"
                required
                maxLength={200}
                className={input}
                placeholder="Value in the view’s dataset_id column"
              />
            </label>
            <label className="text-sm">
              Dataset title
              <input
                name="title"
                required
                minLength={3}
                maxLength={200}
                className={input}
              />
            </label>
            <label className="text-sm">
              Price in USD
              <input
                name="price"
                type="number"
                min="1"
                max="10000"
                step="0.01"
                required
                className={input}
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Description
              <textarea
                name="description"
                required
                minLength={10}
                maxLength={2000}
                rows={3}
                className={input}
              />
            </label>
            <label className="flex items-start gap-3 text-sm text-muted sm:col-span-2">
              <input
                type="checkbox"
                name="synthetic"
                required
                className="mt-1"
              />
              I confirm that this dataset contains synthetic records and that I
              have permission to publish it.
            </label>
            <div>
              <button disabled={busy} className={button}>
                {busy ? "Publishing…" : "Publish dataset"}
              </button>
            </div>
          </form>
        </details>
      )}
      {message && (
        <p role="status" className="mt-5 text-sm text-pp-600 dark:text-pp-400">
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-5 text-sm text-rose-600 dark:text-rose-300"
        >
          {error}
        </p>
      )}
    </section>
  );
}
