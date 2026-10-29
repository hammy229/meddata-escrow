# Devpost submission draft

Working copy of the PayPal AI Hackathon write-up (deadline 2026-11-12). Every
claim here maps to code in this repo; keep it that way when editing. Links
marked `TODO` are filled in once the video and hosted demo exist.

## Tagline

Research data you can trust, paid for only once it is delivered.

## Inspiration

Medical researchers buy datasets blind: they can't inspect quality before
paying, vendors can't trust buyers, and moving raw patient records is a
privacy risk. Escrow solves the trust problem for physical goods — MedData
Escrow applies it to data, with AI doing the procurement legwork.

## What it does

1. A researcher describes a study in plain English.
2. Claude ranks catalog datasets for it (keyword fallback with no AWS). The
   researcher can compare up to three matches side by side before picking one.
3. A sample quality + privacy check runs **before** any money moves.
4. PayPal **authorizes** the listed price, so funds are held, not captured. The
   hold is honored for 3 days and stays valid for up to 29, and the order shows
   how many days are left.
5. The dataset is delivered; the buyer confirms and PayPal **captures**, or
   voids / disputes. The vendor is paid out through PayPal Payouts minus a 10%
   platform fee. Every order ends with a receipt that shows the fee, the
   payout and the query charges.
6. After purchase the researcher asks questions in plain English and gets
   privacy-safe aggregates only, metered per answer, each with a one-sentence
   summary. A question that would expose identifiers is refused with a safe
   rewrite the researcher can try in one click. Raw records never leave the
   vendor.

Or the researcher hands the whole loop to the **procurement agent**: give it
a study and a budget and it searches, inspects, sample-checks and opens a
PayPal escrow order — then stops, because only the human approves payment.

## How we built it

- **Next.js 16 + TypeScript**, one codebase for UI and API; SQLite via
  `node:sqlite` with portable SQL.
- **PayPal**: Orders v2 authorize → capture/void, Payouts, signature-verified
  webhooks with dedupe, and `PayPal-Request-Id` on every write so retries are
  idempotent. A mock mode runs the full arc with no keys.
- **Claude on Amazon Bedrock** (opt-in): dataset ranking, question → typed
  query plan (the model never writes SQL), a privacy second opinion that can
  only tighten, the sample check, and the agent's tool loop.
- **Number-guarded answers.** Claude may reword the one-sentence answer summary,
  but any figure it adds that the rows do not contain is dropped in favor of
  the rule-based sentence. A rewrite for a refused question has to pass the
  same privacy screen before it is offered.
- **Escrow state machine** (`MATCHED → AUTHORIZED → DELIVERED → CAPTURED →
PAID_OUT`, plus dispute/void) with an append-only audit trail of every
  transition.
- **AG Grid** for matches, vendor orders and the ledger; **OpenAPI 3.1** spec
  with drift tests and a generated **Postman** collection; **Render** blueprint;
  signed outbound webhooks for **Zapier**.
- **Hold window, receipts and a webhook simulator.** `lib/escrow/auth-window`
  works out the 3-day honor period and 29-day validity from the authorize
  event. The receipt keeps platform fee plus vendor payout equal to the price.
  The vendor page has a mock PayPal webhook simulator that posts through the
  same webhook route, accepted only in mock mode.
- **AG Grid beyond the defaults.** A custom set filter for order status,
  checkbox row selection for the compare view, inline price editing in the
  catalog, cell renderers for match scores, query bars and status, and a flash
  when a live poll changes an order's status.

## Challenges

- Letting an AI agent spend money safely. The guardrails live in code, not the
  prompt: an order is refused unless the price fits the budget, a _passing_
  sample check ran in the same run, and no order was placed yet. The agent has
  no tool to authorize, capture or pay out.
- Keeping AI out of the trust path. Every AI step has a deterministic
  fallback, and AI can only make privacy decisions stricter.
- Webhooks arrive late, twice, or out of order. Events are deduped in the same
  transaction as the state change and only applied when the transition is
  legal from the current state.

## Accomplishments

- The whole escrow lifecycle runs end to end, keyless, in one command.
- The server, not the client, sets every price and gates every query on a
  paid, delivered order.
- A large `node:test` suite covering the state machine, PayPal client,
  webhooks, privacy screens, agent guardrails and every route.

## What we learned

Agentic commerce needs the same controls as a human buyer — budgets, a
look-before-you-buy step, an audit trail — enforced where the model can't
talk its way around them.

## What's next

- PayPal sandbox credentials and live Bedrock access for the hosted demo.
- Vendor-side dataset onboarding and real (de-identified) data partners.
- Postgres for multi-instance deploys (the SQL is already portable).

## Built with

PayPal (Orders v2, Payouts, Webhooks) · Claude on Amazon Bedrock · Next.js ·
TypeScript · AG Grid · SQLite · OpenAPI · Postman · Render · Zapier

## Links

- Repo: https://github.com/hammy229/meddata-escrow
- Demo video (< 3 min): TODO
- Hosted demo: TODO
