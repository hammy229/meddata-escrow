# Postman

API collection for exercising the meddata-escrow endpoints against a local or
hosted deployment.

Planned requests (placeholder):

- `POST /api/match` — match datasets to a plain-English study description
- `POST /api/orders` — create order + authorize (escrow hold)
- `PATCH /api/orders` — capture or void after the sample check
- `POST /api/query` — run a plain-English query (privacy-safe aggregate)
- `POST /api/billing` — record + charge per-query usage

Export the collection here as `meddata-escrow.postman_collection.json` and a
matching environment as `meddata-escrow.postman_environment.json`.
