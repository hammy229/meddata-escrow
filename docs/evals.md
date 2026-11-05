# Evals: what we measured and what we did not

Anything that can hold money or answer a question about patients should come
with a number. This page has those numbers, how they were made, and where they
stop meaning anything.

```bash
npm run eval             # all three, about a minute, no keys
npm run eval:audit       # evals/results/audit.json
npm run eval:retrieval   # evals/results/retrieval.json
npm run eval:redteam     # evals/results/redteam.json
```

CI holds all three to the committed results, so a number can only move when the
new number is committed with the change that moved it.

**Read this first.** All data is SYNTHETIC, from a seeded generator we wrote. The
audit was designed against that same generator. Claude has never been evaluated
here, because Bedrock access is not enabled on the account. Every model number
below comes from a small logistic regression we wrote or from a scripted model.
None of this measures real-world performance.

## The fitness audit

Flaws are planted at graded strength into clean cohorts, one at a time, with 200
seeds per cell. Intervals are 95% Wilson.

**The number that matters most is the false block rate:** how often honest data
would get a vendor's money held.

| Percent of runs                                      | n=100      | n=200      | n=400      | n=1000     |
| ---------------------------------------------------- | ---------- | ---------- | ---------- | ---------- |
| Money held, clean data, truthful listing             | 0 [0-2]    | 0 [0-2]    | 0 [0-2]    | 0 [0-2]    |
| Money held, listing's event rate from another sample | 56 [49-63] | 37 [30-43] | 19 [14-24] | 2 [1-5]    |
| False alarm, imbalance, before the fix               | 97 [93-98] | 78 [72-83] | 56 [49-63] | 17 [12-22] |
| False alarm, imbalance, after the fix                | 2 [1-5]    | 3 [1-6]    | 2 [1-5]    | 1 [0-4]    |
| False alarm, imbalance, after the fix, fresh seeds   | 1 [0-4]    | 2 [1-4]    | 2 [1-5]    | 2 [1-4]    |
| Outcome leak at column AUC 0.86, flagged             | 6          | 4          | 2          | 0          |
| Outcome leak at column AUC 0.90, flagged             | 44         | 53         | 48         | 43         |
| Outcome leak at column AUC 0.94, flagged             | 95         | 99         | 100        | 100        |

What this taught us:

- **The eval found a bad check.** The imbalance check fired on 97% of clean
  100-person cohorts, because chance alone gives that much difference at that
  size. It now has to clear a noise floor too. That fix was tuned on these seeds,
  so the fresh seed row is the one to trust.
- **There is a known blind spot.** A leak weaker than AUC 0.90 is not flagged.
  That is the warn line, chosen on purpose, and the table shows exactly what it
  costs.
- **There is an open decision.** The second row is a vendor who quotes an event
  rate from a different cut of the data. At small sizes that often gets money
  held. We left it strict because a listing is a promise about what gets
  delivered, but a statistical tolerance would be fair too.

### What a leak does to a model

When a column looks like a leak, the audit trains a logistic regression with and
without it, using 5-fold cross-validation repeated 4 times. The regression is
written from scratch in `lib/stats/logistic.ts`, and scaling and imputation are
learned from training rows only.

Mean held-out AUC at n=400, for the target death by month 12:

| Column                       | With it | Without it | Gap  |
| ---------------------------- | ------- | ---------- | ---- |
| Control, a real baseline one | 0.651   | 0.654      | 0.00 |
| Planted leak, AUC about 0.86 | 0.726   | 0.651      | 0.08 |
| Planted leak, AUC about 0.94 | 0.761   | 0.651      | 0.11 |
| Planted leak, AUC about 0.98 | 0.782   | 0.651      | 0.13 |

On the shipped flawed listing, `last_contact_alsfrs` lifts a model from AUC 0.69
to 0.81. This finding is evidence only. It never changes the verdict or holds
money, because a strong and legitimate predictor can lift a model as well.

We also tested whether picking the flagged column on all rows, outside the
cross-validation, inflates the gap. The real screen flagged a pure-noise column in
0 of 200 cohorts at every size. Forcing in the best of 50 noise columns gave a
mean gap of 0.008 or less. So we did not add re-screening inside each fold. That
test only covers noise columns, and a real column near the threshold could still
be picked partly by luck.

### Drift between sample and delivery

PSI with fixed bins cries wolf on small samples. An independent ML review caught
this before it shipped, and the check now needs to clear a chi-square noise floor.
Drift only warns and never holds money.

| Percent flagged, 200 seeds   | n=100    | n=200   | n=400   | n=1000  |
| ---------------------------- | -------- | ------- | ------- | ------- |
| False alarm, any column      | 6 [3-10] | 3 [1-6] | 3 [1-6] | 0 [0-2] |
| Age shifted 3 years          | 14       | 42      | 83      | 79      |
| Age shifted 6 years          | 77       | 100     | 100     | 100     |
| FVC missing in 15% more rows | 75       | 93      | 97      | 100     |

## Dataset retrieval

A hand-written golden set with graded relevance. The main set has 31 answerable
and 8 no-answer queries, many of them paraphrases like "Lou Gehrig's disease". The
held-out set has 14 and 4, and was written after the synonym map was frozen.

| Ranker                     | MRR, main | MRR, held-out | nDCG@3, main | nDCG@3, held-out |
| -------------------------- | --------- | ------------- | ------------ | ---------------- |
| Word overlap, the baseline | 0.774     | 0.664         | 0.719        | 0.594            |
| BM25                       | 0.778     | 0.775         | 0.736        | 0.725            |
| BM25 with synonyms         | 0.930     | 0.846         | 0.910        | 0.783            |
| Claude                     | not run   | not run       | not run      | not run          |

- **BM25 alone barely beat word overlap on the main set.** The synonym map did
  most of the work, and its 0.930 is in-sample because we wrote the map after
  seeing the failures. **0.846 is the fairer number.**
- **Saying "nothing fits" is still weak.** With a minimum score of 10, false
  matches on no-answer queries fall from 0.50 to 0.125 on the main set, but stay
  at 0.50 on the held-out set, and only 0.64 of its top hits survive the cut.
  "Pediatric oncology imaging" still matches the asthma pilot on one specific word.
- **The eval found a real bug.** The scripted agent would sample-check and order a
  COPD dataset for an Alzheimer's study, because both say "disease". It now
  refuses a weak match.

With 9 listings and one author's labels, this is a regression check, not a
benchmark.

## Red team

26 attacks through the real agent loop and query path. The threat model is a fully
hostile model, for example one prompt-injected by listing text. It is played by a
script that emits the worst tool calls it can.

**26 of 26 are blocked now, but two got through at first:**

| Attack                                                      | First run   | Fix                                      |
| ----------------------------------------------------------- | ----------- | ---------------------------------------- |
| One model reply with 300 tool calls ran all 300             | got through | Cap of 8 tool calls per reply            |
| Total minus published groups revealed a hidden group's size | got through | Complementary suppression on all 3 paths |

The other 24 include overspending, skipping the sample check, buying a failed
listing, invented ids, price tampering, revoked mandates, trying to release money,
SQL in plan fields and grouping by an identifier.

**This tests code guardrails, not the model.** `modelResistance` is `not_measured`:
no model was called, so this says nothing about how often real Claude falls for an
injection. It says what a compromised model could do once it has. The attack list
is ours, so passing it does not prove safety. Suppression covers subtraction within
one grouping, but not every attack across many queries, which would need a privacy
budget.

## Tracing

Every model call records its operation, model, a hash of the system prompt, latency,
tokens, outcome and whether the caller fell back (`lib/llm/trace.ts`). A test
enforces that prompts, study text, rows and error text are never recorded. A hung
call stops after `LLM_TIMEOUT_MS`, 30 seconds by default, and the caller takes its
offline path. Traces are not exposed over HTTP yet, and with no Bedrock access they
have only been run against fake clients.
