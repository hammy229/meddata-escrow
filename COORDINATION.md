# COORDINATION

Shared channel between **Terminal 1** (backend / escrow core) and **Terminal 2**
(UI). Git is the message bus: pull + read this file before each task, add an entry
when you claim files, and put cross-terminal asks under `## Requests`.

Lanes:

- **Terminal 1** — backend / escrow core: `app/api/**`, `lib/escrow/**`,
  `lib/db/**`, `lib/paypal/**`. Owns API contracts + DB schema.
- **Terminal 2** — UI: `app/**` pages & components (dispute/resolve view,
  vendor incoming-orders view). Owns presentation.

Rule: whoever claims a file first here wins; the other waits or works around.

---

## Terminal 1

- **2026-10-11** — Claimed the **order-routes DB wiring** task.
  - Touched: `app/api/orders/route.ts`, `app/api/orders/route.test.ts`,
    `lib/db/client.ts`, `lib/db/usage.ts` (re-export only). Released.
- **2026-10-11 — DONE (pushed).** `/api/orders` now persists through the SQLite
  DB layer; the stored row is the source of truth. Dispute -> resolve flow added.
  Commits: `feat(db): add getDataset + OrderPatch, move withDb to client`;
  `feat(api): persist /api/orders through the DB + dispute/resolve flow`.
  All 82 tests + lint + typecheck green. **The API contract changed — see below.**
- Next up: available. Likely the PayPal sandbox verification is a separate
  dedicated session (not today, per the brief), so holding for the next backend
  slice unless Terminal 2 needs something.

### `/api/orders` contract (NEW — please build the UI against this)

- **POST** `{ datasetId, amount, currency?, referenceId?, buyerEmail? }`
  - `amount` is in **dollars**; `datasetId` must exist (else 422).
  - -> `201 { orderId, paypalOrderId, status, approveUrl, escrowState: "MATCHED", mock? }`
  - **`orderId` is now the DB id (`ord_...`)** — persist/use THIS for all
    follow-up PATCHes. `paypalOrderId` is the separate PayPal order id (was
    previously returned as `orderId`).
- **PATCH** `{ orderId, action, resolution?, requestId? }`
  - `orderId` = the DB id from POST. The server reads `from` state + PayPal ids
    from the row — **callers no longer pass `state`, `authorizationId`, etc.**
  - `action`: `authorize | deliver | capture | payout | void | dispute | resolve`
  - `resolve` also needs `resolution: "capture" | "void"` (capture = vendor is
    paid; void = buyer released).
  - -> `200 { escrowState, ...(authorizationId|captureId|payoutBatchId), mock? }`
  - Errors: `404` unknown orderId · `409` illegal transition (nothing charged) ·
    `422` bad input · `503` PayPal unconfigured · `501` real payout (mock reaches
    PAID_OUT).
- Lifecycle: `MATCHED -authorize-> AUTHORIZED -deliver-> DELIVERED -capture->
  CAPTURED -payout-> PAID_OUT`; `dispute` from AUTHORIZED/DELIVERED -> DISPUTED;
  `resolve` from DISPUTED -> CAPTURED or VOIDED.
- Set `PAYPAL_MODE=mock` (`npm run dev:mock`) for a creds-free, DB-persisted
  demo. Run `npm run seed` once so datasets exist for POST.

## Terminal 2

_(nothing yet)_

## Requests

- **[T1 -> T2]** The dispute/resolve view and vendor incoming-orders view should
  call the **new** `/api/orders` contract above. Key change: use the DB `orderId`
  from POST for PATCHes, and drop any client-side `state`/`authorizationId` — the
  server is authoritative now. Dispute = `{action:"dispute", orderId}`; resolve =
  `{action:"resolve", resolution:"capture"|"void", orderId}`.
- **[T1 -> T2]** `npm run format:check` flags pre-existing Prettier issues in your
  lane: `app/page.tsx`, `app/researcher/page.tsx`, `app/components/DataGrid.tsx`.
  I left them untouched (your lane) — a `prettier --write` on those keeps the
  build green.
- **[T1]** Need a read endpoint (`GET /api/orders` / by id) for your views to
  list/poll order state? Say so here and I'll add it next.
