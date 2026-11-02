# Demo Script

Target: a tight walkthrough under 3 minutes for the demo video. Beats marked
(optional) can be cut to hold that target.

## 0. Setup (before recording)

- `npm install && npm run seed && npm run dev:mock`. The whole arc runs with
  no keys (`PAYPAL_MODE=mock`). For the sandbox cut, use `npm run dev` with
  `PAYPAL_*` set in `.env.local` and a sandbox buyer account ready.
- Optional: `LLM_PROVIDER=bedrock` for live Claude; otherwise the
  deterministic fallbacks produce the same flow.
- Two resets, and they do different things. The mock-mode bar (bottom right)
  has both buttons, and so does `POST /api/demo/reset` (the "Reset the demo
  database" request in the Postman collection, or curl). Both work only in mock
  mode.
  - **Reset** starts from an empty book. Nobody owns anything. Use it before
    the researcher and agent beats.
  - **Reset with sample orders** (`{"seed":"story"}`) adds six orders in
    different states. The default buyer then owns the Heart Failure, COPD and
    Diabetes datasets, so the agent refuses to rebuy COPD. Use it for the vendor
    hold beat.

## 1. The problem (15s)

One line: researchers can't verify data before paying, and sharing raw records
is a privacy risk.

## 2. Researcher describes a study (20s)

Open `/researcher`, type a plain-English study description.

## 3. AI matches datasets (20s)

Show ranked matches in the AG Grid catalog, then run the **sample check** on
the top match. The card shows pass/fail and why, before any money moves. Use the
Cardiology cohort for the purchase in beats 4 to 7.

## 3b. Compare (optional, 15s)

Tick up to three matches on the grid and open the compare table: price, record
count and sample check, with inline bars for the numbers.

## 4. Buy, mock checkout, back (25s)

Click **Buy (escrow)**. The app saves the study text, opens the order, and sends
you to `/checkout/mock`, a local stand-in for PayPal's approval page. Click
**Approve**: PayPal **authorizes** (funds held). Then click **Back to the
workspace**. The workspace reopens `/researcher?orderId=…` from the server, and
the hold chip reads "Funds held · N days left", with the honor period.

## 5. Sample check → capture (25s)

Sample passed, so the purchase goes ahead. Confirm the release on the researcher
side (**Confirm & release payment**) and PayPal **captures**. (Mention: on a
failed sample the authorization is voided and the buyer is never charged.)
Then open the **receipt** card: the 10% platform fee, the vendor payout, the
query charges that add up to the total, and the order's query cap.

## 6. Pay-per-query (25s)

Run a plain-English query and get a privacy-safe aggregate back, with a
one-sentence summary. Each answer is metered against the order's spend cap
($10.00 by default). It is not billed through PayPal. Emphasize: raw records
never left the vendor. (Optional: ask for something identifying, such as "by
zip", and show the **Try instead** rewrite that goes through the same privacy
screen. Optional: once the cap is reached, a question gets a 402 and the
workspace says the order cannot run more queries.)

## 7. Vendor delivers, webhook replays (25s)

Switch to `/vendor` (same take, same order). In the order queue, the authorized
order shows **Deliver data**. Click it. Switch back to the researcher tab: within
a few seconds the workspace picks up the delivery and shows **Download dataset
(link expires HH:MM)**, tagged "demo file". (Say it plainly: the link is a mock
for now.)

Then show the ledger: each row splits into the platform fee and the vendor net,
with the pinned total on the bottom row.

Last, in the webhook simulator, pick an order and send **Capture completed**.
Click **Replay last event**. The second answer reads "Duplicate event id,
nothing changed." This is the dedupe proof. Do it last, because a capture moves
the order on.

## 8. The agent does it for you (25s)

Run the procurement agent in the same take (`POST /api/agent`, or the agent
panel in the researcher workspace) with this study and a $60 budget. The
Cardiology order from beat 4 does not get in the way, because the agent never
reaches that dataset:

> chronic obstructive pulmonary disease exacerbations, heart failure readmissions and blood pressure

Walk through the steps:

1. It searches, and the COPD Exacerbations Panel comes out on top.
2. It inspects COPD ($44.00), then runs the sample check. The check fails on
   duplicate rows (3.4%, over the 2% limit), so it is not bought.
3. It moves to the next in-budget candidate, the Hypertension Registry ($39.00),
   and that check passes. The order opens, and the buyer still approves in PayPal.
4. The shortlist shows the Heart Failure Readmissions dataset at $240.00, over
   budget. The agent never checks or buys it.

Point out that the guardrails are code, not prompt: over-budget or failed-sample
orders are refused, and the agent can't capture or pay out. Then open
`/agent/<runId>` for the replay page. Point at the ranked shortlist, its reasons,
and the guardrail list (enforced, or triggered by a refusal).

Note for the take: after **Reset with sample orders**, the default buyer already
owns COPD. The same study then buys Hypertension straight away, and a COPD-only
study ends with "Nothing was bought: you already own ds_copd_exacerbations_v1."
That is the no-rebuy guardrail, and it can be its own short beat.

## 8b. A mandate keeps the agent on a leash (optional, 15s)

Issue a mandate with `POST /api/mandates` (for example a $50 total and a $45
per-order cap), then pass its `token` to `POST /api/agent` as `mandate`. The run
result shows what was spent, what remains, and any order the mandate denied. Say
that the limit is checked in code, so a prompt cannot talk the agent past it. The
same tools are available to outside agents over `npm run mcp` (see `docs/mcp.md`).

## 8c. Insights and the guided demo (optional, 15s)

Open `/insights` for money held versus released, fees and the dispute rate. If you
want a single clean take of the whole arc, open `/demo` in mock mode and press
Start: it resets, matches, sample-checks, holds, delivers, queries and releases
through the real APIs, with a caption for each step.

## 9. Vendor hold with 2 days left (optional, 15s)

Take this on a **Reset with sample orders** run. On `/vendor`, click the
Diabetes order that is authorized for the demo buyer. The order drawer shows
"Held, capture before it expires · 2 days left", with the hold's dates. The
sample orders are backdated so the hold is 27 days into its 29-day window.

## 10. Wrap-up (15s)

Synthetic data only. Public repo, MIT, runnable from the README.
