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
  -- authorized | captured | voided
  status           TEXT NOT NULL DEFAULT 'authorized',
  amount_cents     INTEGER NOT NULL,
  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-query usage, billed individually.
CREATE TABLE IF NOT EXISTS query_usage (
  id           TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL REFERENCES orders(id),
  question     TEXT NOT NULL,
  charge_cents INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
