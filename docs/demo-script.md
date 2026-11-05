# Demo Script

Target: a tight walkthrough under 3 minutes for the demo video. Beats marked
(optional) can be cut to hold that target.

There are two ways to run it, and they differ on one point that matters.

- **`/demo` (the judge surface).** No account. Press Start and it plays twelve
  steps through the real APIs, over a temporary database that belongs to your
  browser session. It never touches account data. The vendor side is played for
  you, so nothing has to be assigned. Use this for the recording and for anyone
  who just opens the link. It needs `PAYPAL_MODE=mock`.
- **A signed-in take (researcher and vendor accounts).** Every workspace API
  needs login. A vendor can only see and deliver orders on listings their own
  account owns, and a vendor id is `vnd_<accountId>`. The seeded listings belong
  to seed vendors, so a freshly signed-up vendor cannot deliver the Cardiology
  order and will not see it in the queue. Give that vendor the synthetic ALS
  listings first (section 0), then use those listings for the take.

## 0. Setup (before recording)

- `npm install && npm run seed && npm run dev:mock`. The whole arc runs with no
  keys (`PAYPAL_MODE=mock`). For the sandbox cut, use `npm run dev` with
  `PAYPAL_*` set in `.env.local` and a sandbox buyer account ready.
- Optional: `LLM_PROVIDER=bedrock` for live Claude; otherwise the deterministic
  fallbacks produce the same flow.
- For a signed-in take, sign up a vendor and a researcher, finish the vendor
  setup, then run:

  ```
  node --import tsx --env-file-if-exists=.env.local \
    scripts/demo/assign-als-listings.ts --email <vendor email>
  ```

  It moves the three synthetic ALS listings to that vendor. Run it on a local
  database only. It does not undo itself.
- There is no reset button or reset endpoint any more (`POST /api/demo/reset`
  answers 403). `/demo` resets its own session database each time you press
  Start, and loads six sample orders into it.

## 1. The problem (15s)

One line: researchers can't verify data before paying, and sharing raw records
is a privacy risk.

## 2. Researcher describes a study (20s)

Open `/researcher`. For a signed-in take use the ALS study, because the ALS
listings are the ones the vendor owns:

> Predict survival from baseline FVC and age at onset

## 3. AI matches datasets (20s)

Show ranked matches in the AG Grid catalog. The three ALS listings rank first
for that study. Pick one and run **Check sample**. Two cards appear. The
**generic sample check** gives a pass or fail and a score. Under it, the
**fitness screen** lists study problems found in the sample rows (missing
columns, leaks, uneven groups), each with a reason and the numbers behind it.
Say plainly that both are screens, not proof, and that the data is SYNTHETIC.

## 3b. Compare (optional, 15s)

Tick up to three matches on the grid and open the compare table: price, record
count and sample check, with inline bars for the numbers.

## 4. Buy, mock checkout, back (25s)

Click **Buy (escrow)**. The app saves the study text, opens the order, and sends
you to `/checkout/mock`, a local stand-in for PayPal's approval page. Click
**Approve**: PayPal **authorizes** (funds held). Then click **Back to the
workspace**. The workspace reopens `/researcher?orderId=…` from the server, and
the hold chip reads "Funds held · N days left", with the honor period.

## 5. Vendor delivers, the audit runs (30s)

An order has to be delivered before it can be queried or released, so this comes
before the query. Switch to `/vendor`. The authorized order shows **Deliver
data**. Click it. The delivered rows are checked against what the listing
claimed (subject count, record count, event rate, coverage, no features recorded
after the index, one row per subject).

- **Curated listing (`ds_als_survival_curated_v1`).** The sample looked clean,
  the delivery does not. It breaks two claims: baseline FVC coverage and a
  feature recorded after the index. The order moves to **DISPUTED** at once and
  the payment stays held. On `/vendor` the **Delivery audit** card sits above
  the dispute and says why the money is held. On the researcher tab the same
  card shows the findings. A capture attempt through the API is refused with a 409 (the order is
  disputed, so a plain capture is not a legal move). Nothing releases by itself.
  A person decides: the buyer can drop the dispute and release, or the vendor can
  refund, or they agree a split.
- **Clean listing (`ds_als_survival_motorneuron_v1`).** The audit passes. The
  order is DELIVERED, the researcher tab shows **Download dataset (link expires
  HH:MM)**, tagged "demo file", and the release goes ahead normally. (Say it
  plainly: the link is a mock for now.)

Only a broken listing claim holds money. Confounding or low power alone never
does, and a dispute is never settled by software. The audit is a screen, not
proof.

## 6. Pay-per-query (25s)

On a delivered or released order, run a plain-English query and get a
privacy-safe aggregate back, with a one-sentence summary. Each answer is metered
against the order's spend cap ($10.00 by default). It is not billed through
PayPal. Emphasize: raw records never left the vendor. (Optional: ask for
something identifying, such as "by zip", and show the **Try instead** rewrite
that goes through the same privacy screen. Optional: once the cap is reached, a
question gets a 402.)

On an ALS order, scroll to **Survival curves** and press **Show survival
curves** with **Arm** selected. It is billed like any other answer. The chart
shows two arms. The raw log-rank p is below 0.001, and the p within age bands is
0.886 on the curated listing, so the gap goes away once age is held fixed. The
reading under the numbers says so without claiming a cause. The curves sit on a
3 month grid, a curve stops when fewer than 11 people are at risk, and the
at-risk table is rounded to 5. The tag says SYNTHETIC.

The curated order must first be accepted by the buyer (**Drop dispute & release
payment**), because queries need a released or delivered order and its audit
held it. Say so: the buyer chose to keep flagged data after reading the
evidence.

## 7. Release and receipt (25s)

On a clean delivered order, click **Confirm & release payment** and PayPal
**captures**. (Mention: on a failed sample the authorization is voided and the
buyer is never charged.) Then the vendor collects the payout. Open the
**receipt** card: the 10% platform fee, the vendor payout, the query charges that
add up to the total, and the order's query cap. On `/vendor`, the ledger splits
each row into the platform fee and the vendor net, with the pinned total on the
bottom row.

The webhook simulator is not on any page now, so there is no replay to show.
Duplicate event handling is covered by the tests.

## 8. The agent does it for you (25s)

Signed in as the researcher, run the procurement agent (`POST /api/agent`, or
the agent panel in the researcher workspace) with this study and a $60 budget:

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
orders are refused, and the agent can't capture or pay out. The agent also
refuses a dataset that fails the fitness audit. Then open `/agent/<runId>` for
the replay page. Point at the ranked shortlist, its reasons, and the guardrail
list (enforced, or triggered by a refusal).

A new account owns nothing, so the no-rebuy guardrail only shows up on a second
run with the same study.

## 8b. A mandate keeps the agent on a leash (optional, 15s)

Issue a mandate with `POST /api/mandates` (for example a $50 total and a $45
per-order cap), then pass its `token` to `POST /api/agent` as `mandate`. The run
result shows what was spent, what remains, and any order the mandate denied. Say
that the limit is checked in code, so a prompt cannot talk the agent past it. The
same tools are available to outside agents over `npm run mcp` (see `docs/mcp.md`).

## 8c. The guided demo and insights (optional, 30s)

This is the one-take version of everything above, and the best thing to show a
judge who has no account. Open `/demo` in mock mode and press Start. It resets
its own session database, then plays twelve steps through the real APIs, with a
caption for each:

1. Start clean, with six sample orders.
2. Ask and match.
3. Check the sample.
4. Hold the payment.
5. Vendor delivers.
6. Ask a question.
7. Release the funds (a cardiology order, paid out).
8. Buy a curated ALS listing. The sample screen passes. The payment is held.
9. The delivery fails its audit. Two claims are broken, the order is DISPUTED,
   a release attempt is refused with a 409, and the money is still held.
10. An arbiter reads the evidence and advises (it recommends a refund here). It
    moves no money.
11. A clean ALS listing passes its audit and is paid out.
12. Back on the held order, the buyer keeps the data on purpose, and one
    survival question shows the arm gap go from p below 0.001 to p 0.886 once
    age band is held fixed. The chart is on screen with the SYNTHETIC tag.

Open `/insights` for money held versus released, fees and the dispute rate on
your own account. The `/demo` run does not change those totals.

## 9. Wrap-up (15s)

Synthetic data only. The audit is a screen, not proof. Public repo, MIT,
runnable from the README.
