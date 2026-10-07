# Sponsor-tool verification pass (do in a plugin-loaded session)

Today's build is mock-first. These steps need the **PayPal AI-Toolkit plugin**
and the **PayPal sandbox MCP server**, which aren't available in a plain
`claude` session. Relaunch from this repo with:

```bash
claude --plugin-dir /path/to/AI-Toolkit
```

(after minting a sandbox token into `~/.claude/settings.json` → `env.PAYPAL_SANDBOX_ACCESS_TOKEN`,
per the AI-Toolkit README), then:

- [ ] `/paypal:setup` — confirm the plugin is wired to the sandbox app.
- [ ] Put the sandbox Client ID/Secret in `.env.local` (`cp .env.example .env.local`), never in a prompt.
- [ ] `/paypal:test-accounts` — grab a sandbox **buyer** login to approve orders.
- [ ] Run the real loop end-to-end via the **PayPal sandbox MCP**: create an
      `intent=AUTHORIZE` order → approve as the buyer → authorize → **capture** one,
      and **void** another. Confirm `lib/paypal/client.ts` matches the MCP's observed calls.
- [ ] `/paypal:doctor` — run after the escrow module (it's written: `lib/paypal/client.ts`).
- [ ] Use the `paypal-best-practices` skill when hardening the PayPal code.
- [ ] Add the webhook handler: verify signatures before any state change; treat
      webhooks as the source of truth (not in today's scope).

## Agent Toolkit × Bedrock — finding (your item 3, before building that piece)

**Verdict: it works with Bedrock directly — no custom adapter needed, and our
TypeScript stack is the supported one.**

- The toolkit ships a dedicated Bedrock entrypoint:
  `import { PayPalAgentToolkit, ALL_TOOLS_ENABLED } from '@paypal/agent-toolkit/bedrock';`
- Integration is the **Bedrock Converse API** (`ConverseCommand` with a
  `toolConfig` tools array) via `BedrockRuntimeClient`. The model returns
  tool-use blocks; you execute them with `paypalToolkit.handleToolCall()`.
- This is **native Bedrock function calling**, which **Claude models on Bedrock
  support first-class** — so "the AI agent creates the order from its own match
  recommendation" means: give Converse the Claude model id + the toolkit's tools,
  let it emit a PayPal tool-use, and execute it. No adapter layer.
- **Bedrock integration is TypeScript-only** — matches this repo (we chose TS).
- Prereqs: Bedrock **Claude model access in us-east-1** (AWS step 3) and a PayPal
  **sandbox access token** in env for the toolkit.

Sources:

- [PayPal Agent Toolkit quickstart](https://developer.paypal.com/ai-tools/toolkit)
- [Agent toolkit docs](https://www.paypal.ai/docs/tools/agent-toolkit-quickstart)
- [github.com/paypal/agent-toolkit](https://github.com/paypal/agent-toolkit)
