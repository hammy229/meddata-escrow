# Trust layer

Three features that make escrow decisions explainable. None of them can move money on their own.

## Trust score (`GET /api/trust`)

A 0-100 score and letter grade (A 85+, B 70+, C 55+, D 40+, F) for a vendor or a dataset, built in `lib/trust/score.ts` as a pure function over DB rows.

| Factor                 | Weight | Signal                                                                           |
| ---------------------- | ------ | -------------------------------------------------------------------------------- |
| Sample check pass rate | 30     | Rules verdict over the catalog's vendor sample profile                           |
| Dispute rate           | 25     | Orders with a DISPUTE event / all orders                                         |
| Dispute outcomes       | 20     | Disputes the buyer dropped and paid (RESOLVE_CAPTURE) vs refunded (RESOLVE_VOID) |
| Delivery speed         | 15     | Median time from AUTHORIZE to DELIVER, full credit at 1 hour, none at 72         |
| Order volume           | 10     | Saturating, half credit at 8 orders                                              |

Every rate is shrunk toward a neutral 0.5 using 4 pseudo-observations, so one clean order cannot look perfect and one bad order is not ruinous. Each factor returns a plain-English `reason`.

- `GET /api/trust?vendorId=v1` or `?datasetId=ds_...` returns one subject, `{ ..., trust: { score, grade, factors } }`.
- `GET /api/trust` lists every vendor and dataset.
- Unknown id is 404; both ids at once is 422.

## Dispute arbiter (`GET /api/orders?id=<id>&arbitrate=1`)

For a DISPUTED order only (anything else is 409), `lib/ai/arbiter.ts` reads the audit trail with notes, the sample check and delivery data, and returns a recommendation:

```json
{
  "outcome": "refund | release | split | needs_human",
  "confidence": 0.85,
  "rationale": "...",
  "evidence": ["..."],
  "source": "rules | llm",
  "advisoryOnly": true
}
```

- With `LLM_PROVIDER=bedrock`, Claude answers through the shared seam with a zod-validated schema. In mock mode, or on any LLM failure or off-schema answer, deterministic rules decide.
- The arbiter never moves money. The module imports no escrow service, PayPal client or DB writer (a test enforces this), and the endpoint is read-only. Settling still goes through the normal `resolve` action.
- Confidence below 0.6 is forced to `needs_human` in code, whichever reviewer produced the answer.

## Data use agreement (`GET /api/orders?id=<id>&receipt=1`)

`lib/escrow/dua.ts` generates a plain-text agreement covering parties, order id, dataset, amount, issue time, permitted use, no re-identification, aggregate-only output and retention. The receipt response carries `dua: { text, sha256 }` next to `receipt`.

The text is deterministic (the timestamp is the order's creation time), so anyone can recompute the SHA-256 from the order and confirm which terms applied.
