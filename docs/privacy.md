# Privacy

## Principle

Raw patient-level records **never leave the vendor**. Researchers only ever
receive **privacy-safe aggregates**. On top of that, **all data is synthetic**
(Synthea) — there is **no real patient data** anywhere in the system.

## Threat model

- A buyer tries to reconstruct individuals from query results.
- A query is crafted to return row-level or near-unique data.
- Result sets with very small groups leak identity.

## Synthetic data (Synthea)

Datasets are generated with [Synthea](https://github.com/synthetichealth/synthea)
via [`../scripts/generate-data.sh`](../scripts/generate-data.sh). Output lives in
`data/synthea/` and is git-ignored.

## Privacy guard

`lib/ai/privacy-guard` screens both the compiled query and its results:

- Reject row-level / identifying requests (`checkQuery`).
- Enforce minimum group sizes and small-cell suppression on results (`checkResult`).

## De-identification & retention

Only aggregate outputs are stored for billing/audit; no raw records are persisted
by the marketplace.
