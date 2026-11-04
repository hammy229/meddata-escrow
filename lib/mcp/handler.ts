// MCP (Model Context Protocol) server logic, transport-free and dependency-free.
//
// handleMessage(session, message) is a pure-ish JSON-RPC 2.0 handler: one
// parsed message in, one response (or null for a notification) out. The stdio
// framing lives in ./stdio and scripts/mcp-server.ts.
//
// Tools (any MCP client, e.g. Claude Desktop or Alexa+, can buy medical data
// through PayPal escrow):
//   search_datasets     rank the catalog for a study
//   sample_check        quality + privacy check on a dataset's sample
//   place_escrow_order  open a MATCHED escrow order; REQUIRES a valid spending
//                       mandate (POST /api/mandates) and a passing sample check
//   get_order           read an order's escrow state
//
// The tools reuse lib/agent/tools executors, so the SAME guardrails apply as
// for the in-app agent: price, passing sample check, no re-buying an owned
// dataset, and the mandate's per-order / total / vendor / tag / expiry limits.
// Funds are held only after the human buyer approves at approveUrl; no tool
// here can authorize, capture or pay out.
import * as z from "zod/v4";
import { verifyMandate } from "../agent/mandate";
import { spentUnderMandate } from "../agent/mandate-ledger";
import { isMandateRevoked } from "../agent/mandate-store";
import {
  createAgentContext,
  executeTool,
  type AgentContext,
} from "../agent/tools";
import { getOrder, withDb } from "../db/store";
import type { EscrowDeps } from "../escrow/service";
import type { AiOptions } from "../ai/options";
export const SERVER_INFO = { name: "meddata-escrow", version: "0.1.0" };
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export type RpcId = string | number | null;
export type RpcResponse =
  | {
      jsonrpc: "2.0";
      id: RpcId;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: RpcId;
      error: {
        code: number;
        message: string;
        data?: unknown;
      };
    };
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
/** State that lives for one MCP connection. */
export interface McpSession {
  /** Datasets whose sample check passed in this session. */
  readonly passedSamples: Set<string>;
  readonly escrowDeps?: EscrowDeps;
  readonly ai: AiOptions;
}
export function createSession(
  init: {
    escrowDeps?: EscrowDeps;
    ai?: AiOptions;
  } = {},
): McpSession {
  return {
    passedSamples: new Set(),
    escrowDeps: init.escrowDeps,
    ai: init.ai ?? {},
  };
}
interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export const MCP_TOOLS: McpTool[] = [
  {
    name: "search_datasets",
    description:
      "Rank the marketplace's medical research datasets against a study " +
      "description. Returns id, title, relevance, rationale and listed " +
      "price in cents for the top matches.",
    inputSchema: {
      type: "object",
      properties: {
        study: { type: "string", description: "The study description." },
        budgetCents: {
          type: "integer",
          description: "Optional budget used to flag withinBudget.",
        },
      },
      required: ["study"],
      additionalProperties: false,
    },
  },
  {
    name: "sample_check",
    description:
      "Run the quality and privacy check on a dataset's sample for a study. " +
      "A passing check is required before place_escrow_order.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        study: { type: "string" },
      },
      required: ["datasetId", "study"],
      additionalProperties: false,
    },
  },
  {
    name: "place_escrow_order",
    description:
      "Open a PayPal escrow order for a dataset at its listed price. " +
      "Requires a signed spending mandate token (POST /api/mandates) and a " +
      "passing sample_check earlier in this session. Orders outside the " +
      "mandate are refused. Funds are held only after the human buyer " +
      "approves at the returned approveUrl.",
    inputSchema: {
      type: "object",
      properties: {
        datasetId: { type: "string" },
        mandate: {
          type: "string",
          description: "Signed spending mandate token.",
        },
        justification: { type: "string" },
        buyerEmail: { type: "string" },
      },
      required: ["datasetId", "mandate"],
      additionalProperties: false,
    },
  },
  {
    name: "get_order",
    description: "Read an escrow order's current state by order id.",
    inputSchema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
      additionalProperties: false,
    },
  },
];
const SearchArgs = z.strictObject({
  study: z.string().trim().min(1).max(1000),
  budgetCents: z.int().positive().optional(),
});
const SampleArgs = z.strictObject({
  datasetId: z.string().trim().min(1),
  study: z.string().trim().min(1).max(1000),
});
const PlaceArgs = z.strictObject({
  datasetId: z.string().trim().min(1),
  mandate: z.string().min(1).max(4096),
  justification: z.string().trim().min(1).max(1000).optional(),
  buyerEmail: z.email().optional(),
});
const OrderArgs = z.strictObject({ orderId: z.string().trim().min(1) });
type ToolResult =
  | {
      ok: true;
      data: unknown;
    }
  | {
      ok: false;
      error: string;
    };
function parseArgs<S extends z.ZodType>(
  s: S,
  args: unknown,
):
  | {
      ok: true;
      value: z.infer<S>;
    }
  | {
      ok: false;
      error: string;
    } {
  const r = s.safeParse(args ?? {});
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    error: `invalid arguments: ${r.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`,
  };
}
function baseContext(
  session: McpSession,
  over: Partial<Parameters<typeof createAgentContext>[0]> = {},
): AgentContext {
  return createAgentContext({
    study: "mcp",
    budgetCents: 1000000,
    ai: session.ai,
    escrowDeps: session.escrowDeps,
    ...over,
  });
}
async function viaAgentTool(
  ctx: AgentContext,
  tool: string,
  input: unknown,
): Promise<ToolResult> {
  const r = await executeTool(ctx, tool, input);
  return r.ok ? { ok: true, data: r.output } : { ok: false, error: r.error };
}
async function searchDatasets(
  session: McpSession,
  args: unknown,
): Promise<ToolResult> {
  const a = parseArgs(SearchArgs, args);
  if (!a.ok) return a;
  const ctx = baseContext(session, {
    study: a.value.study,
    ...(a.value.budgetCents ? { budgetCents: a.value.budgetCents } : {}),
  });
  return viaAgentTool(ctx, "search_datasets", { study: a.value.study });
}
async function sampleCheck(
  session: McpSession,
  args: unknown,
): Promise<ToolResult> {
  const a = parseArgs(SampleArgs, args);
  if (!a.ok) return a;
  const ctx = baseContext(session, { study: a.value.study });
  const r = await viaAgentTool(ctx, "check_sample", a.value);
  if (ctx.passedSamples.has(a.value.datasetId))
    session.passedSamples.add(a.value.datasetId);
  return r;
}
async function placeEscrowOrder(
  session: McpSession,
  args: unknown,
): Promise<ToolResult> {
  const a = parseArgs(PlaceArgs, args);
  if (!a.ok) return a;
  const v = verifyMandate(a.value.mandate);
  if (!v.ok) return { ok: false, error: `mandate rejected: ${v.reason}` };
  const mandate = v.mandate;
  if (await isMandateRevoked(mandate.id))
    return { ok: false, error: "mandate rejected: mandate revoked" };
  const account = (await withDb(
    async (db) =>
      await db
        .prepare("SELECT id, email FROM accounts WHERE lower(email) = ?")
        .get(mandate.buyerId.toLowerCase()),
  )) as { id: string; email: string } | undefined;
  if (account && a.value.buyerEmail && a.value.buyerEmail !== account.email)
    return { ok: false, error: "buyerEmail does not match the mandate owner" };
  const ctx = baseContext(session, {
    accountId: account?.id,
    // The mandate alone bounds spend here (its refusals name the limit hit),
    // so the run budget is the mandate's total.
    budgetCents: mandate.maxTotalCents,
    buyerEmail:
      account?.email ??
      a.value.buyerEmail ??
      (mandate.buyerId.includes("@") ? mandate.buyerId : undefined),
    mandate,
  });
  for (const id of session.passedSamples) ctx.passedSamples.add(id);
  const r = await viaAgentTool(ctx, "create_escrow_order", {
    datasetId: a.value.datasetId,
    justification: a.value.justification ?? "Requested via MCP",
  });
  if (!r.ok) return r;
  const spentCents = await spentUnderMandate(mandate.id);
  return {
    ok: true,
    data: {
      ...(r.data as object),
      mandate: {
        id: mandate.id,
        maxTotalCents: mandate.maxTotalCents,
        spentCents,
        remainingCents: Math.max(mandate.maxTotalCents - spentCents, 0),
      },
    },
  };
}
async function getOrderTool(args: unknown): Promise<ToolResult> {
  const a = parseArgs(OrderArgs, args);
  if (!a.ok) return a;
  const row = await withDb(async (db) => await getOrder(db, a.value.orderId));
  if (!row) return { ok: false, error: `unknown orderId: ${a.value.orderId}` };
  return {
    ok: true,
    data: {
      orderId: row.id,
      datasetId: row.dataset_id,
      status: row.status,
      amountCents: row.amount_cents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  };
}
async function runTool(
  session: McpSession,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "search_datasets":
        return await searchDatasets(session, args);
      case "sample_check":
        return await sampleCheck(session, args);
      case "place_escrow_order":
        return await placeEscrowOrder(session, args);
      default:
        return await getOrderTool(args);
    }
  } catch (err) {
    console.error(`mcp tool ${name} failed:`, err);
    return { ok: false, error: "tool failed unexpectedly" };
  }
}
function ok(id: RpcId, result: unknown): RpcResponse {
  return { jsonrpc: "2.0", id, result };
}
function fail(id: RpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
const Request = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().min(1),
  params: z.unknown().optional(),
});
/** Handle one parsed JSON-RPC message. Returns null for notifications. */
export async function handleMessage(
  session: McpSession,
  message: unknown,
): Promise<RpcResponse | null> {
  const parsed = Request.safeParse(message);
  if (!parsed.success) {
    const id =
      typeof message === "object" &&
      message !== null &&
      !Array.isArray(message) &&
      ["string", "number"].includes(
        typeof (
          message as {
            id?: unknown;
          }
        ).id,
      )
        ? ((
            message as {
              id: string | number;
            }
          ).id as RpcId)
        : null;
    return fail(id, INVALID_REQUEST, "invalid JSON-RPC 2.0 request");
  }
  const { id, method, params } = parsed.data;
  const isNotification = id === undefined;
  if (isNotification) return null; // initialized, cancelled, etc.: nothing to say
  const rid: RpcId = id;
  switch (method) {
    case "initialize": {
      const asked = (
        params as
          | {
              protocolVersion?: unknown;
            }
          | undefined
      )?.protocolVersion;
      const version =
        typeof asked === "string" && SUPPORTED_PROTOCOLS.includes(asked)
          ? asked
          : SUPPORTED_PROTOCOLS[0];
      return ok(rid, {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    case "ping":
      return ok(rid, {});
    case "tools/list":
      return ok(rid, { tools: MCP_TOOLS });
    case "tools/call": {
      const p = params as
        | {
            name?: unknown;
            arguments?: unknown;
          }
        | undefined;
      if (typeof p?.name !== "string")
        return fail(rid, INVALID_PARAMS, "tools/call requires a tool name");
      if (!MCP_TOOLS.some((t) => t.name === p.name))
        return fail(rid, INVALID_PARAMS, `unknown tool: ${p.name}`);
      const r = await runTool(session, p.name, p.arguments);
      const text = JSON.stringify(r.ok ? r.data : { error: r.error });
      return ok(rid, {
        content: [{ type: "text", text }],
        ...(r.ok ? {} : { isError: true }),
      });
    }
    default:
      return fail(rid, METHOD_NOT_FOUND, `method not found: ${method}`);
  }
}
/** Handle one raw line of input (stdio framing). Null means "no reply". */
export async function handleLine(
  session: McpSession,
  line: string,
): Promise<RpcResponse | null> {
  if (!line.trim()) return null;
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return fail(null, PARSE_ERROR, "parse error");
  }
  return handleMessage(session, message);
}
