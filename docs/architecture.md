# Architecture

## Overview

meddata-escrow is a single Next.js (App Router) application. The UI (researcher
and vendor workspaces) and the backend (Next.js API routes) live in one
TypeScript codebase. AI logic sits in `lib/ai`, the PayPal integration in
`lib/paypal`, and persistence in `lib/db` (SQLite via Node's built-in `node:sqlite`; SQL kept
portable).

## Components

| Layer         | Location                                                                    | Responsibility                                    |
| ------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| Researcher UI | `app/researcher`                                                            | Describe a study, browse matches, query, purchase |
| Vendor UI     | `app/vendor`                                                                | List datasets, manage catalog, review orders      |
| API           | `app/api/{match,query,orders,billing,agent,webhooks/paypal,openapi,health}` | Request handlers                                  |
| LLM           | `lib/llm/client`                                                            | Claude on Bedrock (opt-in), structured outputs    |
| AI            | `lib/ai/{matcher,nl2query,privacy-guard,sample-check}`                      | Matching, NL→plan→SQL, privacy, sample check      |
| Agent         | `lib/agent/{tools,run,store}`                                               | Guardrailed procurement tool loop + run audit     |
| Escrow        | `lib/escrow/{state-machine,service,fees,paypal-webhooks}`                   | Transitions, fee split, inbound webhooks          |
| Payments      | `lib/paypal/client`                                                         | Authorize / capture / void / payouts / verify     |
| Events        | `lib/events/outbound`                                                       | Signed outbound webhook per transition            |
| HTTP          | `proxy.ts`, `lib/http`                                                      | Security headers, rate limits, body caps, req ids |
| Data          | `lib/db/{schema.sql,seed.ts}`, `data/catalog.json`                          | Schema + seed                                     |

## Escrow flow

```mermaid
sequenceDiagram
    actor R as Researcher
    participant App as meddata-escrow
    participant AI as AI agent (lib/ai)
    participant PP as PayPal (sandbox)
    participant V as Vendor data

    R->>App: Describe study (plain English)
    App->>AI: match datasets
    AI-->>App: ranked candidates
    App->>AI: sample quality + privacy check (top match)
    App->>PP: create order + AUTHORIZE (hold funds)
    PP-->>App: authorization id
    alt sample check passes
        App->>PP: CAPTURE authorization
        PP-->>App: captured ✓
        App-->>R: access granted
    else sample check fails
        App->>PP: VOID authorization
        PP-->>App: voided (not charged)
        App-->>R: purchase cancelled
    end
    loop each query (billed per use)
        R->>App: plain-English query
        App->>AI: NL→query + privacy guard
        App->>V: run query (aggregates only)
        V-->>App: privacy-safe aggregate
        App->>PP: charge per-query fee
        App-->>R: result (no raw records)
    end
```

## Data flow

Raw records never leave the vendor. Queries are compiled to safe, aggregate-only
operations and results pass through the privacy guard before returning.

## API routes

- `POST /api/match` — rank datasets for a study description
- `POST /api/orders` — create an escrow order at the dataset's listed price
- `PATCH /api/orders` — advance escrow (authorize, deliver, capture, payout,
  void, dispute, resolve)
- `GET /api/orders` — list orders; `?id=&events=1` adds the audit timeline;
  `?summary=1` returns vendor earnings
- `POST /api/query` — plain-English query → privacy-safe aggregate; requires a
  paid, delivered order and meters each answer
- `GET|POST /api/billing` — per-query usage and spend for an order
- `POST /api/agent` — run the procurement agent; `GET /api/agent?runId=`
  replays a stored run
- `POST /api/webhooks/paypal` — signature-verified, deduped PayPal events
- `GET /api/openapi` — the OpenAPI 3.1 contract
- `GET /api/health` — uptime check (DB + mock/live mode)

See the README's "Trust guarantees" and "API reference" for the full contract.

## Data model

See [`../lib/db/schema.sql`](../lib/db/schema.sql): `vendors`, `datasets`,
`orders`, `query_usage`, `order_events` (append-only audit trail),
`paypal_webhook_events` (webhook dedupe), plus `agent_runs` (created by
`lib/agent/store`).

## Deployment (Render)

Defined in [`../render.yaml`](../render.yaml): a Node 24 web service that seeds
a SQLite demo database at boot and health-checks `/api/health`. It runs in
`PAYPAL_MODE=mock` until PayPal sandbox secrets are added. Secrets are set in the
Render dashboard, never committed.
