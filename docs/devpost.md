# Devpost submission draft

Working copy of the PayPal AI Hackathon write-up (deadline 2026-11-12). Every
claim here maps to code in this repo; keep it that way when editing. Links
marked `TODO` are filled in once the video and hosted demo exist.

## Tagline

Research data you can trust, paid for only once it is delivered.

## Inspiration

Medical researchers buy datasets blind: they can't inspect quality before
paying, vendors can't trust buyers, and moving raw patient records is a
privacy risk. Escrow solves the trust problem for physical goods. MedData
Escrow applies it to data, with AI doing the procurement legwork.

## What it does

1. A researcher describes a study in plain English.
2. Claude ranks catalog datasets for it (keyword fallback with no AWS). The
   researcher can compare up to three matches side by side before picking one.
3. A sample quality + privacy check runs **before** any money moves.
4. PayPal **authorizes** the listed price, so funds are held, not captured. The
   hold is honored for 3 days and stays valid for up to 29, and the order shows
   how many days are left.
5. The vendor delivers the dataset from its order queue. The researcher confirms,
   and PayPal **captures**. The vendor is paid out through PayPal Payouts minus a
   10% platform fee. Every order ends with a receipt that shows the fee, the
   payout, the query charges and the order's query cap.
6. After purchase the researcher asks questions in plain English and gets
   privacy-safe aggregates only. Each answer is metered against the order's spend
   cap (default $10.00) and comes with a one-sentence summary. A question that
   would expose identifiers is refused with a safe rewrite the researcher can try
   in one click. Raw records never leave the vendor.

Or the researcher hands the whole loop to the **procurement agent**: give it
a study and a budget and it searches, inspects, sample-checks and opens a
PayPal escrow order, then stops, because only the human approves payment. When a
sample fails, it moves on to the next in-budget candidate. It never buys a
dataset the buyer already owns, and it gets at most three sample checks per run.

## How we built it

- **Next.js 16 + TypeScript**, one codebase for UI and API; SQLite via
  `node:sqlite` with portable SQL.
- **PayPal**: Orders v2 authorize → capture/void, Payouts, signature-verified
  webhooks with dedupe, and `PayPal-Request-Id` on every write so retries are
  idempotent. Live orders carry our order id as `custom_id` and return URLs to
  the researcher workspace. A mock mode runs the full arc with no keys.
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
- **Query caps and expiring links.** Each order stores its own query cap, and the
  API answers `402` before a query that would pass it. Download links are minted
  on every read with a 900-second lifetime. For now they are mock links; S3
  presigned URLs are the planned swap.
- **AG Grid** for matches, the vendor order queue, the ledger and the catalog;
  **OpenAPI 3.1** spec with drift tests and a generated **Postman** collection;
  **Render** blueprint; signed outbound webhooks for **Zapier**.
- **Hold window, receipts and a webhook simulator.** `lib/escrow/auth-window`
  works out the 3-day honor period and 29-day validity from the authorize
  event. The receipt keeps platform fee plus vendor payout equal to the price.
  The vendor page has a mock PayPal webhook simulator that posts through the
  same webhook route, accepted only in mock mode. Replaying an event shows the
  dedupe.
- **AG Grid beyond the defaults.** A custom set filter for order status,
  checkbox row selection for the compare view, inline price editing with undo in
  the catalog, a "Needs action" filter and resolve buttons on the order queue, a
  pinned total row in the ledger, cell renderers for match scores, query bars and
  status, and a flash when a live poll changes an order's status.

- **Spending mandates and an MCP server.** A buyer signs a mandate (budget,
  per-order cap, allowed vendors and tags, expiry), and the agent can only open
  orders it allows. The same tools are exposed over a stdio MCP server, so an
  outside agent such as Claude Desktop can buy through PayPal escrow under the
  same limits.
- **Trust scores, an advisory dispute arbiter and a data use agreement.**
  Vendors and datasets get a 0 to 100 score with plain-English reasons. On a
  disputed order, Claude suggests refund, release or split from the audit trail,
  but cannot move money. Every receipt carries a fingerprinted agreement.
- **Disputes that can actually split.** One side offers a split and the other
  accepts. PayPal captures that part of the hold and releases the rest, and the
  fee, payout and receipt follow the settled amount.
- **Insights and a guided demo.** An `/insights` page shows money held versus
  released, fees and dispute rate. `/demo` plays the whole story through the real
  APIs in one click.

## Challenges

- Letting an AI agent spend money safely. The guardrails live in code, not the
  prompt: an order is refused unless the price fits the budget, the buyer does
  not already own the dataset, a _passing_ sample check ran in the same run, and
  no order was placed yet. The agent has no tool to authorize, capture or pay out.
- Keeping AI out of the trust path. Every AI step has a deterministic
  fallback, and AI can only make privacy decisions stricter.
- Webhooks arrive late, twice, or out of order. Events are deduped in the same
  transaction as the state change and only applied when the transition is
  legal from the current state.

## Accomplishments

- The whole escrow lifecycle runs end to end, keyless, in one command.
- The server, not the client, sets every price and gates every query on a
  paid, delivered order, and caps what each order can be metered for.
- A `node:test` suite of 626 tests covering the state machine, PayPal client,
  webhooks, privacy screens, agent guardrails and every route.

## What we learned

Agentic commerce needs the same controls as a human buyer: budgets, a
look-before-you-buy step, an audit trail. They have to be enforced where the
model can't talk its way around them.

## What's next

- PayPal sandbox credentials and live Bedrock access for the hosted demo.
- Real S3 presigned delivery in place of the mock download link.
- Live PayPal capture for per-query charges (today they are metered in our own
  ledger).
- Vendor-side dataset onboarding and real (de-identified) data partners.
- Postgres for multi-instance deploys (the SQL is already portable).

## Built with

PayPal (Orders v2, Payouts, Webhooks) · Claude on Amazon Bedrock · Next.js ·
TypeScript · AG Grid · SQLite · OpenAPI · Postman · Render · Zapier

## Links

- Repo: https://github.com/hammy229/meddata-escrow
- Demo video (< 3 min): TODO
- Hosted demo: TODO
