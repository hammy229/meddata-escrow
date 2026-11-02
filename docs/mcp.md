# MedData Escrow MCP server

A dependency-free [Model Context Protocol](https://modelcontextprotocol.io)
server over stdio (JSON-RPC 2.0: `initialize`, `tools/list`, `tools/call`,
`ping`). Any MCP client, such as Claude Desktop or Alexa+, can search for
medical research datasets, check a sample, and open a PayPal escrow order,
all bounded by a signed spending mandate.

## Tools

| Tool                 | What it does                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `search_datasets`    | Rank the catalog for a study; returns id, title, score, rationale and listed price in cents.              |
| `sample_check`       | Quality and privacy check on a dataset's sample. A pass is required before ordering.                      |
| `place_escrow_order` | Open a MATCHED escrow order and return the PayPal `approveUrl`. **Requires a valid mandate** (see below). |
| `get_order`          | Read an order's escrow state by `orderId`.                                                                |

The server reuses the same guardrail code as the in-app agent
(`lib/agent/tools.ts`), so these are enforced in code, not by a prompt:

- the dataset exists and the price is the one stored in the database,
- a passing `sample_check` for that dataset ran earlier in the session,
- the buyer does not already own the dataset,
- the mandate's per-order cap, remaining total, vendor and tag allow-lists,
  and expiry all allow the purchase.

No tool can authorize, capture or pay out. Funds are held only after the human
buyer approves at `approveUrl`.

## Spending mandates

A mandate is a buyer policy signed with HMAC-SHA256 (`MANDATE_SECRET`; a dev
fallback is used when unset, so set it for anything real). Issue one:

```bash
curl -s localhost:3000/api/mandates -H 'content-type: application/json' \
  -d '{"maxTotalCents": 10000, "maxPerOrderCents": 6000, "allowedTags": ["cardiology"]}'
# -> { "token": "...", "mandate": { ... } }
```

Give the `token` to the agent and have it pass it as the `mandate` argument of
`place_escrow_order`. A missing, tampered or expired token, or an order outside
the policy, comes back as a tool error (`isError: true`) naming the reason.
Spend is counted when an order is opened, in a per-process ledger that resets
on restart. The same token works for `POST /api/agent` (`mandate` field).

## Run it

```bash
npm run seed   # once: creates data/dev.sqlite with the catalog
npm run mcp    # speaks JSON-RPC on stdin/stdout; logs go to stderr
```

`PAYPAL_MODE` defaults to `mock` here, so no PayPal credentials are needed.
Set `PAYPAL_MODE=sandbox` (with credentials in `.env.local`) for real sandbox
orders.

## Claude Desktop

Add to `claude_desktop_config.json` (use your absolute path):

```json
{
  "mcpServers": {
    "meddata-escrow": {
      "command": "npm",
      "args": ["run", "--silent", "mcp"],
      "cwd": "/absolute/path/to/meddata-escrow",
      "env": {
        "PAYPAL_MODE": "mock",
        "MANDATE_SECRET": "change-me"
      }
    }
  }
}
```

If your client ignores `cwd`, use
`"args": ["--prefix", "/absolute/path/to/meddata-escrow", "run", "--silent", "mcp"]`.
Keep `MANDATE_SECRET` identical to the one the web app uses, or mandates issued
there will fail verification here.

## Try it by hand

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | npm run --silent mcp
```
