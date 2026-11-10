# Sponsor-tool verification pass

Today's build is mock-first. These steps need the **PayPal AI-Toolkit** and the
**PayPal sandbox MCP server**, set up with a sandbox access token as the
AI-Toolkit README describes. Then:

- [ ] Confirm the toolkit is wired to the sandbox app with its setup check.
- [ ] Put the sandbox Client ID/Secret in `.env.local` (`cp .env.example .env.local`), never in a prompt.
- [ ] Create sandbox test accounts and grab a **buyer** login to approve orders.
- [ ] Run the real loop end-to-end via the **PayPal sandbox MCP**: create an
      `intent=AUTHORIZE` order → approve as the buyer → authorize → **capture** one,
      and **void** another. Confirm `lib/paypal/client.ts` matches the MCP's observed calls.
- [ ] Run the toolkit's diagnostics after the escrow module (it's written: `lib/paypal/client.ts`).
- [ ] Check the PayPal code against PayPal's integration best practices.
- [ ] Add the webhook handler: verify signatures before any state change; treat
      webhooks as the source of truth (not in today's scope).

## Agent Toolkit × Bedrock — finding

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
