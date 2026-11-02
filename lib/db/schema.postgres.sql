-- PostgreSQL app schema. Applied explicitly with npm run db:migrate.

-- Vendors offering datasets.
CREATE TABLE IF NOT EXISTS vendors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- PayPal account email the vendor is paid at (Payouts API receiver). NULL =
  -- not onboarded for payouts yet. Added to existing DBs via a guarded ALTER.
  payout_email TEXT,
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('researcher', 'vendor')),
  organization TEXT NOT NULL DEFAULT '',
  purpose TEXT NOT NULL DEFAULT '',
  payout_email TEXT NOT NULL DEFAULT '',
  vendor_id TEXT REFERENCES vendors(id),
  setup_complete INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- Datasets listed in the catalog.
CREATE TABLE IF NOT EXISTS datasets (
  id          TEXT PRIMARY KEY,
  vendor_id   TEXT NOT NULL REFERENCES vendors(id),
  title       TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- Escrowed purchases (PayPal authorize-then-capture).
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  dataset_id       TEXT NOT NULL REFERENCES datasets(id),
  buyer_email      TEXT NOT NULL,
  account_id       TEXT REFERENCES accounts(id),
  paypal_order_id  TEXT,
  authorization_id TEXT,
  -- PayPal Payouts batch id from paying the vendor (set on PAYOUT). Added to
  -- existing DBs via a guarded ALTER in migrate().
  payout_batch_id  TEXT,
  -- Most the buyer can be metered for queries on this order (cents). Added to
  -- existing DBs via a guarded ALTER in migrate().
  query_cap_cents  INTEGER NOT NULL DEFAULT 1000,
  -- Canonical EscrowState (see lib/escrow/state-machine.ts). One of:
  --   MATCHED | AUTHORIZED | DELIVERED | CAPTURED | PAID_OUT
  --   | DISPUTED | VOIDED | CANCELLED
  -- The DB only ever stores a state the state machine produced.
  status           TEXT NOT NULL DEFAULT 'MATCHED',
  amount_cents     INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  -- Bumped on every state transition (see advanceOrder) so the UI can show and
  -- sort by last activity. Added to existing DBs via a guarded ALTER in migrate().
  updated_at       TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- Per-query usage, billed individually.
CREATE TABLE IF NOT EXISTS query_usage (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  question     TEXT NOT NULL,
  charge_cents INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- Immutable audit trail of escrow lifecycle transitions. One row per state
-- change (plus a genesis CREATE row), written inside advanceOrder/createOrder
-- so the history can never drift from the order's current status. `from_state`
-- is NULL only for the genesis row. Append-only — rows are never updated.
CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  -- Monotonic per-order position (0 = genesis). Ordering key for the timeline:
  -- created_at is only second-resolution, so same-second transitions would sort
  -- ambiguously; seq keeps them in the exact order they happened.
  seq         INTEGER NOT NULL,
  event       TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  -- Optional free-text context for a transition: a dispute reason on DISPUTE,
  -- a resolution note on RESOLVE_*. NULL for routine automated transitions.
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- PayPal webhook deliveries we have processed, keyed by PayPal's event id.
-- PayPal retries deliveries until it gets a 2xx, so the same event can arrive
-- more than once; a row here means "already handled" and a replay is a no-op.
-- Written in the same transaction as any state change the event caused.
CREATE TABLE IF NOT EXISTS paypal_webhook_events (
  id           TEXT PRIMARY KEY,           -- PayPal event id (WH-...)
  event_type   TEXT NOT NULL,              -- e.g. PAYMENT.CAPTURE.COMPLETED
  resource_id  TEXT,                       -- resource.id (auth/capture/...)
  order_id     TEXT REFERENCES orders(id), -- NULL when no order matched
  processed_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

-- Read an order's timeline oldest-first (by seq).
CREATE INDEX IF NOT EXISTS idx_order_events_order
  ON order_events (order_id, seq);
-- Each order's events are numbered once. Every writer holds the order row
-- lock today; this stops a future writer from silently reusing a number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_events_seq_unique
  ON order_events (order_id, seq);

-- Application identity. Passwords use salted scrypt; only session token hashes persist.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS account_agent_runs (
  run_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower ON accounts (lower(email));
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY, study TEXT, budget_cents INTEGER, source TEXT,
  order_id TEXT, steps_json TEXT, recommendation_json TEXT,
  created_at TEXT DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE TABLE IF NOT EXISTS app_migrations (version INTEGER PRIMARY KEY, applied_at TEXT DEFAULT (CURRENT_TIMESTAMP::text));

-- Provider credentials are encrypted with an application-held AES-256-GCM key.
CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  label TEXT NOT NULL,
  host TEXT NOT NULL,
  database_name TEXT NOT NULL,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  encrypted_config TEXT NOT NULL,
  fields_json TEXT NOT NULL,
  tested_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS source_connection_id TEXT REFERENCES provider_connections(id);
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS source_dataset_key TEXT;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS record_count INTEGER;
ALTER TABLE datasets ADD COLUMN IF NOT EXISTS tags_json TEXT;
