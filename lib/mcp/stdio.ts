// Newline-delimited JSON-RPC over a stream pair (the MCP stdio transport):
// one message per line in, one response per line out. Nothing but protocol
// messages may be written to `output`; diagnostics belong on stderr.
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import { handleLine, type McpSession } from "./handler";

/** Resolves when the input stream ends and every reply has been written. */
export async function serveStdio(
  input: Readable,
  output: Writable,
  session: McpSession,
): Promise<void> {
  const rl = createInterface({ input, crlfDelay: Infinity });
  // Sequential: replies keep request order and the guardrails see prior state.
  for await (const line of rl) {
    const reply = await handleLine(session, line);
    if (reply) output.write(JSON.stringify(reply) + "\n");
  }
}
