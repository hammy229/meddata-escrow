# Progress & Handoff — MedData Escrow

Last updated: 2026-10-06 · Author: Arham

This note is for my hackathon partner (and the AI coding agent they use) so you
can pick up exactly where I left off without needing my chat history.

## Instructions for an AI agent reading this on my partner's behalf

Before you change, add, or delete anything, do this first:

1. **Review my commits in order.** Run `git log --reverse --stat` and read each
   commit message and diff. The messages are written in plain language and
   explain what each step did and why. There are 9 commits.
2. **Read the code the commits introduced**, in this order: `backend/paypal_client.py`,
   `backend/escrow.py`, `backend/matcher.py`, `backend/handlers.py`,
   `backend/test_escrow.py`, then `frontend/lib/*`, `frontend/app/api/*`,
   `frontend/app/*`.
3. **Run the checks** (below) so you know the current baseline is green before
   you touch anything.
4. **Summarize to your user** what exists, what is still a stub or mock, and
   what is open, using the sections below. Then ask your user what they want to
   take on, and avoid duplicating work listed as done.
5. **Do not overwrite or rewrite history** on this branch. Add new commits on
   top, and keep commit messages in plain language like the existing ones.

## What exists (all working in mock mode)

- **PayPal client** (`backend/paypal_client.py`, `frontend/lib/paypal.ts`):
  two modes via `PAYPAL_MODE` — `mock` (no network) and `sandbox` (real PayPal
  sandbox API: token, create order, capture, webhook signature verify).
- **Escrow state machine** (`backend/escrow.py`, `frontend/lib/escrow.ts`):
  `PENDING_PAYMENT -> FUNDED -> RELEASED`, with illegal jumps rejected and
  webhook funding that is idempotent. Download is blocked until `FUNDED`.
- **AI matching** (`backend/matcher.py`, `frontend/lib/matcher.ts`): ranks
  datasets for a plain-English request. Backend can call Claude on Amazon
  Bedrock (`USE_BEDROCK=1`); everything else uses a keyword fallback.
- **Lambda handlers** (`backend/handlers.py`): match, create order, PayPal
  webhook, download, confirm.
- **Frontend** (`frontend/`, Next.js 14 App Router): search page, ranked
  matches, order status page with a step indicator. Its API routes are local
  TypeScript ports of the backend logic so the demo runs with one command and
  no AWS.
- **Tests:** 5 backend tests covering the escrow rules.

## How to run

```bash
# backend tests
cd backend && pip install -r requirements.txt && python -m pytest -q

# frontend demo (mock mode, no keys needed)
cd frontend && npm install && cp .env.example .env.local && npm run dev
# open http://localhost:3000
```

Secrets: real keys go only in a local, gitignored `.env` / `.env.local`.
Never commit them. Only the blank `.env.example` files are tracked.

## Known gaps / honest caveats

- The frontend "Pay with PayPal" button is a **mock**: it captures and funds in
  one call. Real sandbox mode needs the PayPal JS SDK button plus the webhook.
- The webhook needs a **public URL** (deployed API Gateway or a tunnel like
  ngrok) to receive PayPal events. The signature check only runs in sandbox mode
  and has **not** been tested against real PayPal yet.
- The frontend and backend implement the same logic twice (TS for the demo,
  Python for the AWS deploy). Keep them in sync or collapse to one.
- S3 presigned downloads and DynamoDB storage are written but **not exercised**
  (the app uses a stubbed URL and an in-memory store locally).
- Listings are a hard-coded demo catalog of 3 datasets.
- The escrow here **captures payment at checkout** and holds the data, not the
  money. A stricter design uses PayPal authorize-then-capture-or-void, as the
  separate `main` branch's docs describe.

## Relationship to `main`

This branch has its **own git history**, separate from `main`, which has a
different scaffold (README, CI, Render config, docs, mostly stubbed code). They
do not merge cleanly. Deciding which structure to build on, and porting working
logic across, is an open decision for the two of us.

## Open work (pick one, tell me which)

1. Decide the base: `main`'s structure, this branch, or port this logic into `main`.
2. Wire real PayPal sandbox: JS SDK button + webhook on a public URL.
3. AWS deploy template (Lambda, API Gateway, DynamoDB, S3).
4. Real Bedrock matching, replacing the keyword fallback.
5. Demo script and README polish for the Devpost submission (deadline Nov 12, 2026).
