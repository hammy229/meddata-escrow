# meddata-escrow

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/hammy229/meddata-escrow/actions/workflows/ci.yml/badge.svg)](https://github.com/hammy229/meddata-escrow/actions/workflows/ci.yml)

## In Progress: MedData Escrow

MedData Escrow is an AI procurement and escrow marketplace for medical research data. Buyers describe the data they need, Amazon Bedrock (Claude) matches relevant dataset listings, PayPal authorizes and holds payment before access is granted, and data is delivered through time-limited Amazon S3 presigned URLs before payment is captured and settled with the seller.

**Tech stack:** Amazon Bedrock (Claude), Amazon S3, DynamoDB, AWS Lambda + API Gateway, and PayPal sandbox APIs.

**Status:** Actively building for the PayPal AI Hackathon (Devpost deadline: November 12, 2026).

**Architecture flow:** Request → Bedrock match → PayPal authorization → S3 delivery → capture → seller payout.

> **An AI procurement + escrow marketplace for medical research data.** Describe your study in plain English; an AI agent finds the right dataset, verifies a sample, and buys it via PayPal escrow — funds captured only if the sample passes.

## Problem & who it's for

Medical-school researchers waste weeks sourcing data: they can't inspect quality before paying, vendors can't trust buyers, and sharing raw records creates serious privacy risk. **meddata-escrow** is for **academic medical researchers** (and the data vendors who serve them). It makes buying research data trustworthy on both sides:

- Buyers never pay for data that fails a quality/privacy check.
- Vendors never release raw records — only privacy-safe aggregates leave their systems.
- Everything is metered, so researchers pay for exactly what they use.

> ⚕️ **All data is synthetic**, generated with [Synthea](https://github.com/synthetichealth/synthea). **No real patient data** is used anywhere.

## How it works (6-step flow)

1. **Describe** — A researcher describes their study in plain English.
2. **Match** — An AI agent matches vendor datasets in the catalog and ranks them by fit (`lib/ai/matcher`).
3. **Sample check** — The agent runs an automated quality + privacy check on a sample of the top match.
4. **Escrow (authorize)** — PayPal **authorizes** the purchase amount — funds are _held, not captured_ (`/api/orders`).
5. **Capture or void** — If the sample check passes, PayPal **captures** the payment; if it fails, the authorization is **voided** and the researcher is never charged.
6. **Query & bill** — After purchase, plain-English queries return **privacy-safe aggregates** (`lib/ai/nl2query` + `lib/ai/privacy-guard`), each **billed per query** via PayPal. Raw records never leave the vendor.

## Tools used & how

| Tool                                      | How it's used                                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **PayPal** (Orders/Payments API, sandbox) | Escrow via authorize-then-capture; per-query billing (`lib/paypal/client.ts`, `app/api/orders`, `app/api/billing`) |
| **LLM API** (hosted)                      | Dataset matching, natural-language → query translation, and privacy screening (`lib/ai/*`)                         |
| **AG Grid**                               | Interactive dataset catalog and query-result tables in the researcher/vendor UIs                                   |
| **Render**                                | One-click deploy of the web service (+ Postgres) via [`render.yaml`](./render.yaml)                                |
| **Postman**                               | API collection to exercise and demo every endpoint ([`postman/`](./postman))                                       |

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full design and the escrow-flow Mermaid diagram.

```
Researcher UI ─▶ /api/match   ─▶ lib/ai/matcher          (rank vendor datasets)
             ─▶ /api/orders  ─▶ lib/paypal/client        (authorize → sample check → capture/void)
             ─▶ /api/query   ─▶ lib/ai/nl2query          (NL → safe query)
                              └▶ lib/ai/privacy-guard     (screen query + results)
             ─▶ /api/billing ─▶ lib/paypal/client        (per-query charge)
Vendor UI    ─▶ manage catalog (data/catalog.json → DB via lib/db)
Data layer   ─▶ lib/db/schema.sql  (SQLite local · Postgres in prod)
```

## Quick start

```bash
# 1. Clone
git clone https://github.com/hammy229/meddata-escrow.git
cd meddata-escrow

# 2. Install
npm install

# 3. Configure environment
cp .env.example .env.local        # then fill in the values (see table below)

# 4. Seed the local database
npm run seed

# 5. Run the dev server
npm run dev                       # http://localhost:3000
```

Production build: `npm run build && npm start`.

### Environment variables

| Variable                       | Required | Description                                            |
| ------------------------------ | :------: | ------------------------------------------------------ |
| `PAYPAL_CLIENT_ID`             |    ✅    | PayPal **sandbox** app client ID                       |
| `PAYPAL_CLIENT_SECRET`         |    ✅    | PayPal **sandbox** app secret                          |
| `PAYPAL_API_BASE`              |    ✅    | PayPal API base (`https://api-m.sandbox.paypal.com`)   |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` |    ✅    | Client ID exposed to the browser for the PayPal JS SDK |
| `LLM_API_KEY`                  |    ✅    | Hosted LLM API key                                     |
| `LLM_API_BASE`                 |    ✅    | LLM API base URL                                       |
| `LLM_MODEL`                    |    ✅    | LLM model name                                         |
| `DATABASE_URL`                 |    ✅    | `file:./data/dev.sqlite` locally; Postgres URL in prod |
| `NEXT_PUBLIC_APP_URL`          |    ✅    | Public base URL of the app                             |

> 🔒 Never commit secrets. Only `.env.example` (with empty placeholders) is tracked.

### PayPal sandbox setup

1. Sign in at the [PayPal Developer Dashboard](https://developer.paypal.com/dashboard/).
2. Go to **Apps & Credentials → Sandbox** and **Create App**.
3. Copy the **Client ID** and **Secret** into `.env.local` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`).
4. Keep `PAYPAL_API_BASE=https://api-m.sandbox.paypal.com`.
5. Use the dashboard's **Sandbox → Accounts** to get a test buyer login for the demo.

## Demo

- 🌐 **Hosted demo:** _placeholder — link coming soon_
- 🎥 **Demo video (YouTube, < 3 min):** _placeholder — link coming soon_

### Run it locally

```bash
npm test               # unit tests (node:test + tsx): escrow state machine, SQLite
                       # persistence, PayPal client, matcher, nl2query, privacy guard, routes
npm run demo           # happy-path CLI: match → authorize → deliver → capture → payout
npm run dev:mock       # full UI + API, no PayPal keys needed (http://localhost:3000)
npm run demo -- --sandbox "heart disease cohort"   # real sandbox calls (.env.local)
```

**Try the full flow in the browser (no credentials):** `npm run dev:mock`, then
open [`/researcher`](http://localhost:3000/researcher) — describe a study, pick a
ranked match, **Buy (escrow)**, then walk the escrow arc with the on-page buttons
(**Deliver → Confirm & release → Pay out vendor**) and run a privacy-safe query.
[`/vendor`](http://localhost:3000/vendor) shows the dataset catalog.

The escrow lifecycle is a pure state machine in `lib/escrow/state-machine.ts`
(`MATCHED → AUTHORIZED → DELIVERED → CAPTURED → PAID_OUT`, with
`DISPUTED → VOIDED | CAPTURED`); order state persists via SQLite
(`lib/db`, built on Node's `node:sqlite`). Everything is **mock-first**: both the
CLI (`npm run demo`) and the app (`PAYPAL_MODE=mock`) drive the real state machine,
matcher, and privacy guard against stubbed PayPal + delivery, so no AWS and no
credentials are needed. The real sandbox path drops in behind the same interfaces —
see [TODO-paypal-tools.md](./TODO-paypal-tools.md) for the sponsor-tool
verification pass (AI-Toolkit plugin + PayPal MCP).

## Project structure

```
meddata-escrow/
├─ app/
│  ├─ researcher/            # researcher workspace (browse, query, buy)
│  ├─ vendor/                # vendor workspace (manage listings)
│  └─ api/
│     ├─ match/              # POST  — match datasets to a study description
│     ├─ orders/             # POST/PATCH — authorize → capture/void (escrow)
│     ├─ query/              # POST  — plain-English query (privacy-safe aggregate)
│     └─ billing/            # POST  — per-query charge
├─ lib/
│  ├─ ai/                    # matcher, nl2query, privacy-guard
│  ├─ paypal/                # PayPal Orders/Payments client
│  └─ db/                    # schema.sql, seed.ts
├─ data/catalog.json         # dataset catalog (synthetic)
├─ scripts/                  # generate-data.sh (Synthea), seed.sh
├─ docs/                     # architecture, paypal-flow, privacy, demo-script, checklist
├─ postman/                  # API collection
├─ render.yaml               # Render deploy config
└─ .github/                  # CI workflow + PR/issue templates
```

## Contributing & security

See [CONTRIBUTING.md](./CONTRIBUTING.md) and [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE) © 2026 Arham Doshi
