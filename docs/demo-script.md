# Demo Script

Target: a tight walkthrough under 3 minutes for the demo video. Beats marked
(optional) can be cut to hold that target.

## 0. Setup (before recording)

- `npm install && npm run seed && npm run dev:mock`. The whole arc runs with
  no keys (`PAYPAL_MODE=mock`). For the sandbox cut, use `npm run dev` with
  `PAYPAL_*` set in `.env.local` and a sandbox buyer account ready.
- Optional: `LLM_PROVIDER=bedrock` for live Claude; otherwise the
  deterministic fallbacks produce the same flow.
- Between takes, reset the demo data with `POST /api/demo/reset` (the
  "Reset the demo database" request in the Postman collection, or curl). It
  works only in mock mode and clears orders, events, usage and agent runs, then
  reseeds the catalog and its prices.

## 1. The problem (15s)

One line: researchers can't verify data before paying, and sharing raw records
is a privacy risk.

## 2. Researcher describes a study (20s)

Open `/researcher`, type a plain-English study description.

## 3. AI matches datasets (20s)

Show ranked matches in the AG Grid catalog, then run the **sample check** on
the top match. The card shows pass/fail and why, before any money moves.

## 3b. Compare (optional, 15s)

Tick up to three matches on the grid and open the compare table: price, record
count and sample check, with inline bars for the numbers.

## 4. Escrow: authorize (25s)

Trigger purchase → **Buy** opens `/checkout/mock`, a local stand-in for PayPal's
approval page (mock mode). Approve → PayPal **authorizes** (funds held). Point
out the hold window on the order: honored for 3 days, valid for up to 29.

## 5. Sample check → capture (25s)

Sample passes → PayPal **captures**. (Mention: on failure it voids, buyer not charged.)
Then open the **receipt** card: the 10% platform fee, the vendor payout, and the
query charges that add up to the total.

## 6. Pay-per-query (25s)

Run a plain-English query → privacy-safe aggregate returned, with a one-sentence
summary → per-query charge in PayPal. Emphasize: raw records never left the vendor.
(Optional: ask for something identifying, such as "by zip", and show the
**Try instead** rewrite that goes through the same privacy screen.)

## 7. The agent does it for you (20s)

`POST /api/agent { study, budgetCents }` (Postman collection, "Agent"): show
the step list: search → inspect → sample check → escrow order, and point out
the guardrails are code, not prompt: over-budget or failed-sample orders are
refused, and the agent can't capture or pay out. Then open `/agent/<runId>`
for the replay page and point at the ranked shortlist and its reasons.

## 8. Vendor side (10s)

`/vendor`: the order in the ledger grid with its audit timeline, earnings
summary, and the 10% platform fee on payout. (Optional: edit a listing's price
inline, then send a mock PayPal event from the webhook simulator and watch the
status cell flash in the ledger.)

## 9. Wrap-up (15s)

Synthetic data only. Public repo, MIT, runnable from the README.
