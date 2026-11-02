// Guided demo script. Each step calls the app's real HTTP APIs (through an
// injected fetch, so tests can run it in process) and reports facts read from
// the responses. Nothing here invents data: if an API call fails, the step
// throws a StoryError and the walkthrough stops with that message.
//
// Needs PAYPAL_MODE=mock, because the first step resets the database.
import { suggestQuestions } from "../../lib/query/suggestions";

export type StepId =
  "reset" | "match" | "sample" | "hold" | "deliver" | "query" | "release";

export interface StepDef {
  id: StepId;
  title: string;
  caption: string;
}

export const STEPS: StepDef[] = [
  {
    id: "reset",
    title: "Start clean",
    caption:
      "Reset this walkthrough’s isolated mock database and load six sample orders. Your account data stays unchanged.",
  },
  {
    id: "match",
    title: "Ask and match",
    caption:
      "A researcher describes a study in plain English. The matcher ranks the catalog against it.",
  },
  {
    id: "sample",
    title: "Check the sample",
    caption:
      "Before any money moves, the vendor sample is checked for quality and privacy.",
  },
  {
    id: "hold",
    title: "Hold the payment",
    caption:
      "The buyer approves and PayPal authorizes the amount. The funds are held in escrow, not paid.",
  },
  {
    id: "deliver",
    title: "Vendor delivers",
    caption:
      "The vendor delivers the dataset. The buyer now has an expiring link and can query it.",
  },
  {
    id: "query",
    title: "Ask a question",
    caption:
      "A plain-English question becomes an aggregate-only query. Raw records never leave the vendor.",
  },
  {
    id: "release",
    title: "Release the funds",
    caption:
      "The buyer is satisfied, so PayPal captures the payment and the vendor is paid, minus the platform fee.",
  },
];

/** The study the walkthrough asks about. */
export const STORY_DESCRIPTION =
  "Cardiovascular patient cohort with BMI, age and diagnosis for a risk study";

export interface StoryCtx {
  description?: string;
  datasetId?: string;
  datasetTitle?: string;
  priceCents?: number;
  orderId?: string;
}

export interface Fact {
  label: string;
  value: string;
  tone?: "held" | "released";
}

export interface StepOutcome {
  ctx: StoryCtx;
  facts: Fact[];
  /** Set when the story ends early for an honest reason (not an error). */
  halt?: string;
  link?: { href: string; label: string };
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class StoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoryError";
  }
}

export function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// ---- HTTP helper ----------------------------------------------------------

// Responses are our own JSON APIs; fields are read defensively below.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function call(
  f: Fetcher,
  label: string,
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown,
): Promise<Json> {
  let res: Response;
  try {
    res = await f(url, {
      method,
      cache: "no-store",
      ...(body !== undefined && {
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new StoryError(`${label}: could not reach the server.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reasons = Array.isArray(data?.reasons)
      ? ` (${data.reasons.join("; ")})`
      : "";
    throw new StoryError(
      `${label}: ${data?.error ?? `server responded ${res.status}`}${reasons}`,
    );
  }
  return data;
}

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined || value === "")
    throw new StoryError(`This step needs ${what} from an earlier step.`);
  return value;
}

// ---- Steps ----------------------------------------------------------------

export async function runStep(
  id: StepId,
  ctx: StoryCtx,
  f: Fetcher,
): Promise<StepOutcome> {
  switch (id) {
    case "reset": {
      try {
        const res = await f("/api/demo/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ seed: "story" }),
        });
        if (res.status === 404)
          throw new StoryError(
            "The guided demo needs PAYPAL_MODE=mock, because it resets the database.",
          );
        if (!res.ok)
          throw new StoryError(`Reset: server responded ${res.status}.`);
      } catch (err) {
        if (err instanceof StoryError) throw err;
        throw new StoryError("Reset: could not reach the server.");
      }
      const list = await call(f, "Reset check", "GET", "/api/orders");
      const n = Array.isArray(list.orders) ? list.orders.length : 0;
      return {
        ctx: {},
        facts: [
          { label: "Database", value: "reset" },
          { label: "Sample orders", value: String(n) },
        ],
      };
    }

    case "match": {
      const data = await call(f, "Match", "POST", "/api/match", {
        description: STORY_DESCRIPTION,
      });
      const top = data.matches?.[0];
      if (!top)
        throw new StoryError("Match: the catalog returned no datasets.");
      return {
        ctx: {
          description: STORY_DESCRIPTION,
          datasetId: top.datasetId,
          datasetTitle: top.title ?? top.datasetId,
          priceCents:
            typeof top.priceCents === "number" ? top.priceCents : undefined,
        },
        facts: [
          { label: "Study", value: STORY_DESCRIPTION },
          { label: "Best match", value: top.title ?? top.datasetId },
          { label: "Why", value: String(top.rationale ?? "ranked first") },
          ...(typeof top.priceCents === "number"
            ? [{ label: "Price", value: usd(top.priceCents) }]
            : []),
          {
            label: "Ranked by",
            value: data.source === "llm" ? "Claude" : "keyword matcher",
          },
        ],
      };
    }

    case "sample": {
      const datasetId = need(ctx.datasetId, "a matched dataset");
      const data = await call(f, "Sample check", "POST", "/api/match", {
        sampleCheck: datasetId,
        description: ctx.description,
      });
      const check = data.sampleCheck;
      const facts: Fact[] = [
        { label: "Verdict", value: check.passed ? "Passed" : "Failed" },
        { label: "Score", value: `${check.score} / 100` },
        ...(check.findings?.[0]
          ? [{ label: "Finding", value: String(check.findings[0]) }]
          : []),
      ];
      if (!check.passed)
        return {
          ctx,
          facts,
          halt: "The sample failed the check, so no payment was authorized and no money moved. That is the point of checking first.",
        };
      return { ctx, facts };
    }

    case "hold": {
      const datasetId = need(ctx.datasetId, "a matched dataset");
      const created = await call(f, "Create order", "POST", "/api/orders", {
        datasetId,
      });
      const orderId: string = created.orderId;
      await call(f, "Approve and authorize", "PATCH", "/api/orders", {
        orderId,
        action: "authorize",
      });
      const read = await call(
        f,
        "Read order",
        "GET",
        `/api/orders?id=${encodeURIComponent(orderId)}`,
      );
      const left = read.authorization?.daysLeft;
      return {
        ctx: { ...ctx, orderId },
        facts: [
          { label: "Order", value: orderId },
          { label: "State", value: read.order.status, tone: "held" },
          {
            label: "Held in escrow",
            value: usd(read.order.amount_cents),
            tone: "held",
          },
          ...(typeof left === "number"
            ? [{ label: "Hold window", value: `${left} days left` }]
            : []),
        ],
        link: {
          href: "/researcher",
          label: "Open your researcher workspace",
        },
      };
    }

    case "deliver": {
      const orderId = need(ctx.orderId, "an authorized order");
      await call(f, "Deliver", "PATCH", "/api/orders", {
        orderId,
        action: "deliver",
      });
      const read = await call(
        f,
        "Read order",
        "GET",
        `/api/orders?id=${encodeURIComponent(orderId)}`,
      );
      return {
        ctx,
        facts: [
          { label: "State", value: read.order.status, tone: "held" },
          {
            label: "Delivery link",
            value: read.delivery
              ? "issued, expires in 15 minutes"
              : "not issued",
          },
          {
            label: "Still held",
            value: usd(read.order.amount_cents),
            tone: "held",
          },
        ],
      };
    }

    case "query": {
      const orderId = need(ctx.orderId, "a delivered order");
      const datasetId = need(ctx.datasetId, "a matched dataset");
      const question = suggestQuestions(datasetId)[1];
      const data = await call(f, "Query", "POST", "/api/query", {
        orderId,
        datasetId,
        question,
      });
      const rows: unknown[] = Array.isArray(data.result) ? data.result : [];
      return {
        ctx,
        facts: [
          { label: "Question", value: question },
          {
            label: "Answer",
            value: String(data.summary ?? `${rows.length} rows`),
          },
          {
            label: "Compiled to",
            value: String(data.compiled?.sql ?? "aggregate query"),
          },
          { label: "Metered", value: usd(data.usage?.chargeCents ?? 0) },
        ],
      };
    }

    case "release": {
      const orderId = need(ctx.orderId, "a delivered order");
      await call(f, "Capture", "PATCH", "/api/orders", {
        orderId,
        action: "capture",
      });
      await call(f, "Payout", "PATCH", "/api/orders", {
        orderId,
        action: "payout",
      });
      const read = await call(
        f,
        "Receipt",
        "GET",
        `/api/orders?id=${encodeURIComponent(orderId)}&receipt=1`,
      );
      const r = read.receipt;
      return {
        ctx,
        facts: [
          { label: "State", value: r.status, tone: "released" },
          {
            label: "Vendor paid",
            value: usd(r.vendorPayoutCents),
            tone: "released",
          },
          { label: "Platform fee", value: usd(r.platformFeeCents) },
          { label: "Query charges", value: usd(r.queryChargesCents) },
          { label: "Total charged", value: usd(r.totalCents) },
        ],
        link: { href: "/insights", label: "Open your account insights" },
      };
    }
  }
}
