# Postman

A runnable Postman collection for the meddata-escrow API, generated from
[`openapi/openapi.yaml`](../openapi/openapi.yaml).

| File                                      | What it is                                         |
| ----------------------------------------- | -------------------------------------------------- |
| `meddata-escrow.postman_collection.json`  | The collection (Postman v2.1)                      |
| `meddata-escrow.postman_environment.json` | Local environment: `baseUrl=http://localhost:3000` |

Both files are generated. Do not edit them by hand. Change the spec, then run:

```bash
npm run postman:gen
```

`npm test` fails if the committed collection is out of date with the spec.

## What's in the collection

1. **Demo: full escrow arc.** Nine ordered requests that drive one order end to
   end: match → create order → authorize → deliver → query → billing →
   capture → payout → order with audit events. `datasetId` and `orderId` chain
   through collection variables, and each step asserts its status code and
   escrow state.
2. **One folder per API area** (System, Matching, Orders, Query, Billing, Agent,
   Webhooks). There is one request per operation, using the spec's example
   body. Happy-path requests assert their status code. They reuse the order
   the demo leaves behind (`{{orderId}}`, `PAID_OUT`), so run the demo
   folder first.
   _Agent_ and _Webhooks_ are **preview** operations. They are documented
   ahead of their implementation, have no assertions, and return 404 until
   their routes land.

## Run it

The demo needs a server in mock mode. Live PayPal needs a buyer to approve
the order between create and authorize.

```bash
npm run seed            # once, to load the dataset catalog
npm run dev:mock        # PAYPAL_MODE=mock next dev, http://localhost:3000
```

### In the Postman app

1. **Import** → select both JSON files in this folder. Or import the spec
   straight from the running server: `http://localhost:3000/api/openapi`.
2. Pick the **meddata-escrow (local)** environment.
3. Right-click the collection → **Run collection**, keeping the folder order.

### From the command line (Newman)

```bash
npx newman run postman/meddata-escrow.postman_collection.json \
  -e postman/meddata-escrow.postman_environment.json
```

To point at another server, add `--env-var baseUrl=http://localhost:3109`
or a hosted URL.
