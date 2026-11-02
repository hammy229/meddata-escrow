// MedData Escrow MCP server over stdio (JSON-RPC 2.0, no dependencies).
//
//   npm run mcp          # PAYPAL_MODE=mock by default; see docs/mcp.md
//
// stdout carries ONLY protocol messages; logs go to stderr.
import { createSession } from "../lib/mcp/handler";
import { serveStdio } from "../lib/mcp/stdio";

// Mock-first: never touch PayPal unless the operator opts in explicitly.
process.env.PAYPAL_MODE ??= "mock";
// Library code logs with console.log in places; keep stdout clean.
console.log = (...args: unknown[]) => console.error(...args);

async function main() {
  console.error(
    `meddata-escrow MCP server ready (PAYPAL_MODE=${process.env.PAYPAL_MODE})`,
  );
  await serveStdio(process.stdin, process.stdout, createSession());
}

main().catch((err) => {
  console.error("mcp server crashed:", err);
  process.exit(1);
});
