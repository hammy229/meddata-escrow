# Demo Script

Target: a tight walkthrough under 3 minutes for the demo video.

## 0. Setup (before recording)

- `npm install && npm run seed && npm run dev:mock` — the whole arc runs with
  no keys (`PAYPAL_MODE=mock`). For the sandbox cut, use `npm run dev` with
  `PAYPAL_*` set in `.env.local` and a sandbox buyer account ready.
- Optional: `LLM_PROVIDER=bedrock` for live Claude; otherwise the
  deterministic fallbacks produce the same flow.

## 1. The problem (15s)

One line: researchers can't verify data before paying, and sharing raw records
is a privacy risk.

## 2. Researcher describes a study (20s)

Open `/researcher`, type a plain-English study description.

## 3. AI matches datasets (20s)

Show ranked matches in the AG Grid catalog, then run the **sample check** on
the top match — the card shows pass/fail and why, before any money moves.

## 4. Escrow: authorize (25s)

Trigger purchase → PayPal **authorizes** (funds held). Show the sandbox hold.

## 5. Sample check → capture (25s)

Sample passes → PayPal **captures**. (Mention: on failure it voids, buyer not charged.)

## 6. Pay-per-query (25s)

Run a plain-English query → privacy-safe aggregate returned → per-query charge
in PayPal. Emphasize: raw records never left the vendor.

## 7. The agent does it for you (20s)

`POST /api/agent { study, budgetCents }` (Postman collection, "Agent"): show
the step list — search → inspect → sample check → escrow order — and point out
the guardrails are code, not prompt: over-budget or failed-sample orders are
refused, and the agent can't capture or pay out.

## 8. Vendor side (10s)

`/vendor`: the order in the ledger grid with its audit timeline, earnings
summary, and the 10% platform fee on payout.

## 9. Wrap-up (15s)

Synthetic data only. Public repo, MIT, runnable from the README.
