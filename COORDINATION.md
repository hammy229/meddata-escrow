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

- **2026-10-11** — Claimed the **UI contract-alignment + Prettier** slice.
  - Touched: `app/researcher/page.tsx`, `app/page.tsx`, `app/components/DataGrid.tsx`.
    Released.
- **2026-10-11 — DONE.** Aligned the researcher escrow flow to the new
  `/api/orders` contract: all PATCHes now send only `{ action, orderId }` (plus
  `resolution` where relevant). Dropped the client-side `state`/`authorizationId`
  that the server now derives from the DB row, and removed the now-dead
  `authorizationId` React state. POST already consumed `orderId` as the DB id, so
  no change needed there.
  - Also ran `prettier --write` on the three flagged lane files. `format:check`
    is now clean for my lane (only `COORDINATION.md`, shared, remained — folded
    into this commit).
  - `npm test` (84 pass) + `eslint` + `typecheck` all green locally.
- **Blocked / next up:** the **vendor incoming-orders view** and a standalone
  **dispute/resolve view** both need to _read_ order state (list + load-by-id),
  which the current API can't do. See the request below — I'll build both as soon
  as the read endpoint lands.

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
- **[T2 -> T1] DONE:** researcher flow now matches the new PATCH contract
  (`{action, orderId}` only; no more `state`/`authorizationId` from the client).
  Prettier run on the three flagged files + `COORDINATION.md`. Build is green.
- **[T2 -> T1] YES, please build `GET /api/orders`** — it's the blocker for both
  views you asked for. Shape that works for me:
  - **List:** `GET /api/orders` -> `200 { orders: [...] }`, newest first. Each row
    needs: orderId, datasetId, buyerEmail, amountCents, escrowState,
    paypalOrderId, createdAt, updatedAt.
  - **By id:** `GET /api/orders?id=ord_...` (or `/api/orders/[id]`) ->
    `200 { order }` with the same fields, `404` on unknown id — drives the
    dispute/resolve view.
  - A `?state=DISPUTED` (or `?datasetId=`) filter is a nice-to-have for the vendor
    list, but I can filter client-side for the demo — don't block on it.
  - Keep `escrowState` as the canonical string (`MATCHED`/`AUTHORIZED`/`DELIVERED`/
    `CAPTURED`/`PAID_OUT`/`DISPUTED`/`VOIDED`) so I can reuse the stepper, and
    `amountCents` (not dollars) — the UI already formats cents.

  Once it's on main I'll wire the vendor incoming-orders list (polling this) and a
  dispute → resolve(capture|void) view against it.
