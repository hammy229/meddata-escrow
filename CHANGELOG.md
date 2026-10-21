# Changelog

All notable changes to MedData Escrow. Newest first.

## 2026-10-21 — Trust hardening, audit trail UI, earnings & spend

A security and product pass: the server now enforces who pays what and who
sees what, and both workspaces show where the money is.

### Security

- **Listed-price escrow** — `POST /api/orders` charges the dataset's price; a
  client `amount` that doesn't match is `422`.
- **Paid-order query gate** — `POST /api/query` requires an `orderId` for that
  dataset in `DELIVERED`, `CAPTURED` or `PAID_OUT` (`grantsDataAccess`); access
  freezes during a dispute.
- **Server-set billing** — the per-query fee is fixed server-side (one constant
  in `lib/query/pricing`); `/api/billing` rejects client prices and orders
  without data access (`409`).
- **Two-stage privacy screen** — plain-English questions are screened for
  identifiers and row-level asks (`checkQuestion`), then the compiled SQL is
  re-checked as aggregate-only. Questions are capped at 500 characters.

### Added

- Per-answer metering on `/api/query` (`usage` in the response).
- `GET /api/billing?orderId=` (usage + spend), `GET /api/orders?summary=1`
  (vendor earnings), `GET /api/health`.
- **Audit trail UI** — an `OrderTimeline` stepper in the researcher escrow
  panel and an expandable History row on vendor incoming orders, with dispute
  notes.
- **Earnings summary** on the vendor workspace and **query spend** on the
  researcher workspace.

### Fixed

- Plain-English questions like "How many patients by sex?" were rejected
  because the privacy check demanded SQL syntax.
- Grouped averages returned counts instead of averages.
- The compiled SQL never rendered on the researcher query panel.
- Render deployed on Node 20, but `node:sqlite` needs Node ≥ 22; now Node 24
  with `/api/health` as the health check.

### CI & repo

- CI now runs the test suite (140 tests), with a read-only token, a timeout
  and cancellation of superseded runs.
- Dependabot for npm (minor/patch, grouped) and GitHub Actions; issue forms
  with a no-PHI reminder; updated PR template.

## 2026-10-15 — PayPal-blue rebrand

Recolored the whole product from emerald to a **PayPal-blue** system for the
PayPal AI Hackathon — primary `#0070e0`, navy `#003087`.

### Changed

- Added a `pp-50..950` PayPal-blue ramp to the Tailwind theme and repointed the
  accent/ring/soft tokens (light + dark) and AG Grid selection to it.
- Recolored the landing, researcher and vendor workspaces, the incoming-orders
  view, and the AG Grid accent; the closing CTA band is now a
  `pp-600 → pp-900` (PayPal navy) gradient.

## 2026-10-15 — Landing page: a held escrow order, front and center

Elevated the marketing home around the one idea that makes the product
different — funds are **held** until delivery is confirmed — while keeping the
shipped emerald identity.

### Added

- **Signature hero visual** — the plain lifecycle list became a bespoke "held
  order" card: order id + `FUNDS HELD` pill, the dataset and amount in tabular
  mono, a buyer → vendor held-funds track, and the `MATCHED..PAID_OUT` ledger
  with each state's plain meaning (`AUTHORIZED` shown current). Reuses the
  existing `.reveal` / `.held-dot` motion — no new keyframes.
- **Landing screenshots** (`docs/screenshots/`) — thumbnail, light, dark, and
  mobile captures, surfaced at the top of the README.
- **Share metadata** — OpenGraph + Twitter `summary_large_image` with
  `/og.png`, title template, and `metadataBase` from `NEXT_PUBLIC_SITE_URL`.

### Changed

- **Landing craft pass** (emerald identity kept): bolder hero with the promise
  set in emerald and a proof row; a faint masked grid backdrop; "How it works"
  reworked from an equal-card grid into a two-column lifecycle timeline; and a
  confident emerald closing band in place of the plain CTA row.

## 2026-10-11 — Escrow persistence + dispute/resolve + read API

Backend/escrow core is now DB-backed end to end, and the full dispute flow is in.
Paired with the matching UI (vendor incoming-orders view + dispute/resolve), all
on `main` and green (90 tests, lint, typecheck, build).

### Added

- **`GET /api/orders`** read endpoint — list (newest first), single by id
  (`?id=ord_…`), and `?status=` / `?datasetId=` / `?buyerEmail=` filters. Backs
  the vendor incoming-orders view and the dispute queue.
- **Dispute → resolve flow** on `PATCH /api/orders`: `dispute` (from
  AUTHORIZED/DELIVERED) and `resolve` with `resolution: "capture" | "void"` (from
  DISPUTED).
- **`updated_at`** on orders, bumped on every state transition (so the UI can
  sort/show by last activity). Safe migration for existing DBs via a guarded ALTER.
- DB helpers: `listOrders`, `getDataset`, and `ESCROW_STATES` / `isEscrowState`.
- **Vendor incoming-orders view** (`app/components/IncomingOrders.tsx`) polling GET
  every 5s, plus a researcher-side "Raise dispute" button and resolve controls.

### Changed — ⚠️ `/api/orders` contract (update any caller)

- **`/api/orders` now persists through SQLite** — the stored order row is the
  source of truth. The transition is validated against the state machine _before_
  any PayPal call, so an illegal move is a clean `409` and never charges anyone.
- **POST** returns `orderId` = the **DB id (`ord_…`)** plus a separate
  `paypalOrderId`. Use `orderId` for all follow-up PATCHes. (Previously `orderId`
  was the PayPal order id.)
- **PATCH** takes `{ orderId, action, resolution?, requestId? }`. The server reads
  the `from` state and PayPal ids from the row — **callers no longer send
  `state` / `authorizationId`.**
- Mock mode (`PAYPAL_MODE=mock`) still persists, so the creds-free demo now has
  real, queryable order rows.

### Notes

- No credentials/accounts/money touched — still mock-first. PayPal sandbox
  verification remains a separate dedicated pass (see `TODO-paypal-tools.md`).
- Run `npm run seed` once so datasets exist before POSTing an order.
