# API spec, Postman and APIMatic

The whole HTTP API is described by one OpenAPI 3.1 document,
[`openapi/openapi.yaml`](../openapi/openapi.yaml). Every other API artifact
comes from it: the Postman collection, the served spec, and any SDKs or docs
portal built with APIMatic.

```
openapi/openapi.yaml ──┬── GET /api/openapi            (served JSON / YAML)
                       ├── npm run postman:gen  ──►  postman/*.json  ──►  Postman app / Newman
                       └── APIMatic import      ──►  SDKs (TS, Python, Java, …) + API portal
```

## The spec

- Covers every route under `app/api/**`, with the request bodies, response
  bodies and status codes the route code and its tests actually produce, plus
  realistic examples.
- Shared shapes live under `components.schemas`: `OrderRow`, `OrderEventRow`,
  `UsageRow`, `OrderSummary`, the `EscrowState` enum (all 8 states) and
  `Error` (`{ error, reasons? }`).
- `operationId`s are camelCase (`createOrder`, `advanceOrder`, `runQuery`, …).
  SDK generators use them as method names.
- Operations whose code has not landed yet are marked `x-status: preview`:
  `POST /api/agent`, `POST /api/webhooks/paypal`, and the `source` /
  `sampleCheck` additions to `/api/match`.

**Drift guard.** `scripts/openapi/spec.test.ts` runs in `npm test`. It fails
when a `route.ts` exports a method the spec lacks, or when the spec documents
an operation with no handler that is not marked preview. It also fails on a
missing, duplicate or non-camelCase `operationId`, or a `$ref` that does not
resolve.

**Served spec.** A running server returns the spec at
`GET /api/openapi` (JSON) and `GET /api/openapi?format=yaml` (raw YAML), so
tools can import it by URL.

## Postman

`npm run postman:gen` (`scripts/openapi/to-postman.ts`) builds a Postman v2.1
collection from the spec. It is hand-built with no converter dependency, so
the output is deterministic:

- a **"Demo: full escrow arc"** folder that drives one order through match →
  create → authorize → deliver → query → billing → capture → payout → audit
  events, chaining ids through `pm.collectionVariables`;
- one folder per tag, one request per operation, with example bodies and
  status-code tests on the happy paths;
- a `{{baseUrl}}` variable, plus a local environment file.

The generated files are committed, and `npm test` fails if they are stale. For
import steps and how to run with Newman, see
[`postman/README.md`](../postman/README.md).

## APIMatic

APIMatic takes an OpenAPI file and generates client SDKs and a hosted
developer portal. Nothing has been generated from this repo yet. These are
the steps to do it.

### In the web app

1. Sign in at [apimatic.io](https://www.apimatic.io/) and choose **Import
   API**.
2. Upload `openapi/openapi.yaml`, or give the URL of a running server's
   `/api/openapi?format=yaml`.
3. Review the validation report. The spec uses only local `$ref`s, so it
   imports as a single file.
4. **Generate SDK.** Pick the languages (for example TypeScript, Python and
   Java) and download them. Method names come from the `operationId`s, so
   `createOrder` becomes `ordersController.createOrder(...)` or similar,
   depending on the language.
5. **Generate API portal** to publish reference docs, with code samples in
   each SDK language, from the same import.

### With the APIMatic CLI

```bash
npm install -g @apimatic/cli
apimatic auth:login                         # API key from your APIMatic account

# Validate the spec
apimatic api:validate --file=openapi/openapi.yaml

# Generate SDKs
apimatic sdk:generate --file=openapi/openapi.yaml --platform=typescript --destination=./sdk
apimatic sdk:generate --file=openapi/openapi.yaml --platform=python     --destination=./sdk
apimatic sdk:generate --file=openapi/openapi.yaml --platform=java       --destination=./sdk

# Generate a static API portal
apimatic portal:generate --folder=./portal-src --destination=./portal
```

Command names and flags can vary between CLI versions. Check
`apimatic --help` before scripting them.

**Notes for SDK users.**

- `GET /api/orders` returns one of three shapes depending on the query string
  (`OrderListResponse`, `OrderDetailResponse`, `OrderSummaryResponse`), so it
  is modelled as a `oneOf`.
- In mock mode (`PAYPAL_MODE=mock`), responses add `mock: true` and use
  `MOCK-*` PayPal ids. In live mode, PayPal failures pass PayPal's status
  through (the `default` response).
- Preview operations may change shape before they ship. Regenerate SDKs after
  their routes land.
