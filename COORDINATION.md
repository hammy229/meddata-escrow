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

- **2026-10-11** — Claiming the **order-routes DB wiring** task.
  - Touching: `app/api/orders/route.ts`, `app/api/orders/route.test.ts`,
    `lib/db/client.ts`, `lib/db/usage.ts` (re-export only).
  - Goal: `/api/orders` persists through the SQLite DB layer so every transition
    runs through the tested state machine; the DB row becomes the source of
    truth (no more caller-supplied `state`). Then: dispute -> resolve flow.
  - Not touching any `app/**` page or component — that's Terminal 2's lane.

## Terminal 2

_(nothing yet)_

## Requests

_(nothing yet)_
