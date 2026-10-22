# Changelog

All notable changes to MedData Escrow. Newest first.

## 2026-10-22 — The agent gets a face; coverage and docs catch up

### Added

- **"Or let the agent buy it"** on the researcher workspace: set a budget and
  watch the procurement agent's steps, guardrail refusals, recommendation and
  the escrow order it opens, with the PayPal approve link (`AgentRun`).

### Fixed

- The landing "Built with" strip showed a broken AWS logo (Simple Icons
  dropped every AWS mark); it now uses a local glyph.
- Agent step summaries now show counts for lists and skip long prose.

### Tests

- Direct specs for query-usage persistence, mock-mode ids, and every PayPal
  webhook mapping branch (dispute-time resolution, auth creation, malformed
  payloads). 273 → 290 tests.

### Docs

- README: AI & agent section, full API table, sponsor tools, redrawn
  architecture map, agent screenshot. Architecture doc, demo script and a
  Devpost draft (`docs/devpost.md`) brought up to date.

## 2026-10-21 (later) — Claude on Bedrock, real PayPal money moves, API contract

The second half of the day turned the mock-first core into something that can
talk to real services, without breaking the creds-free demo.

### AI (Claude on Bedrock)

- **Provider seam** — `lib/llm/client.ts` adds a Claude-on-Bedrock client with
  structured outputs, opt-in via `LLM_PROVIDER=bedrock`. Every caller keeps a
  deterministic fallback, so the app runs identically with no AWS access.
- **Dataset ranking** with Claude; keyword matching remains the fallback.
- **Query plans, never LLM SQL** — Claude turns a question into a typed plan
  that `compilePlan` compiles; the model never writes SQL.
- **Second-opinion privacy screen** that can only tighten a verdict, never
  loosen it.
- **Sample quality check** before buying (`POST /api/match { sampleCheck }`).
- **Procurement agent** — `POST /api/agent` runs a tool loop with budget and
  sample-check guardrails and a scripted fallback; runs are persisted in
  `agent_runs` and readable via `GET /api/agent?runId=`.

### PayPal

- Escrow transitions moved into one service (`lib/escrow/service.ts`).
- Every PayPal write carries a `PayPal-Request-Id`, so retries are idempotent.
- Vendors are paid through the **Payouts API** with a 10% platform fee
  (`lib/escrow/fees.ts`; vendor + fee always equals the capture).
- `POST /api/webhooks/paypal` verifies signatures with PayPal, dedupes by event
  id, and applies only legal state-machine transitions.
- Escrow transitions emit **signed outbound webhooks** (Zapier-ready).

### API contract

- OpenAPI 3.1 spec for every route (`openapi/openapi.yaml`), served at
  `GET /api/openapi`, with drift tests against the route files.
- Generated, runnable Postman collection (`npm run postman:gen`).

### Security

- Strict security headers and CSP on every response.
- Rate limits on the expensive routes and request body caps (32 KB; 256 KB
  for webhooks), enforced in `proxy.ts`.
- An `X-Request-Id` on every API response.

### UI (AG Grid)

- Dataset matches, vendor orders and the vendor ledger in AG Grid, with
  saved column state and CSV export; the sample check and a "how this answer
  was computed" panel on the researcher side.

### Fixed

- The Render blueprint now deploys on the free plan.
- The ledger total row no longer leaks into CSV exports; user sort and column
  widths survive grid re-renders.

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
