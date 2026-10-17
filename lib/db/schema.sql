-- meddata-escrow schema (SQLite for local dev, Postgres-ready).
-- Placeholder: column types kept portable; refine per engine later.

-- Vendors offering datasets.
CREATE TABLE IF NOT EXISTS vendors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Datasets listed in the catalog.
CREATE TABLE IF NOT EXISTS datasets (
  id          TEXT PRIMARY KEY,
  vendor_id   TEXT NOT NULL REFERENCES vendors(id),
  title       TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Escrowed purchases (PayPal authorize-then-capture).
CREATE TABLE IF NOT EXISTS orders (
  id               TEXT PRIMARY KEY,
  dataset_id       TEXT NOT NULL REFERENCES datasets(id),
  buyer_email      TEXT NOT NULL,
  paypal_order_id  TEXT,
  authorization_id TEXT,
  -- Canonical EscrowState (see lib/escrow/state-machine.ts). One of:
  --   MATCHED | AUTHORIZED | DELIVERED | CAPTURED | PAID_OUT
  --   | DISPUTED | VOIDED | CANCELLED
  -- The DB only ever stores a state the state machine produced.
  status           TEXT NOT NULL DEFAULT 'MATCHED',
  amount_cents     INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Bumped on every state transition (see advanceOrder) so the UI can show and
  -- sort by last activity. Added to existing DBs via a guarded ALTER in migrate().
  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-query usage, billed individually.
CREATE TABLE IF NOT EXISTS query_usage (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  question     TEXT NOT NULL,
  charge_cents INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Immutable audit trail of escrow lifecycle transitions. One row per state
-- change (plus a genesis CREATE row), written inside advanceOrder/createOrder
-- so the history can never drift from the order's current status. `from_state`
-- is NULL only for the genesis row. Append-only — rows are never updated.
CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id),
  event       TEXT NOT NULL,
  from_state  TEXT,
  to_state    TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Read an order's timeline oldest-first.
CREATE INDEX IF NOT EXISTS idx_order_events_order
  ON order_events (order_id, created_at, id);
