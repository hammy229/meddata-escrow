# Changelog

All notable changes to MedData Escrow. Newest first.

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
