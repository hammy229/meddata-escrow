// Guided demo script. Each step calls the app's real HTTP APIs (through an
// injected fetch, so tests can run it in process) and reports facts read from
// the responses. Nothing here invents data: if an API call fails, the step
// throws a StoryError and the walkthrough stops with that message.
//
// Needs PAYPAL_MODE=mock, because the first step resets the database.
import { suggestQuestions } from "../../lib/query/suggestions";
import type { SurvivalAnalysis } from "../../lib/query/survival-analysis";

export type StepId =
  | "reset"
  | "match"
  | "sample"
  | "hold"
  | "deliver"
  | "query"
  | "release"
  | "curated_buy"
  | "audit_fail"
  | "arbiter"
  | "clean_pass"
  | "survival";

/** The ALS listings the second half of the story uses. All SYNTHETIC. */
export const CURATED_ID = "ds_als_survival_curated_v1";
export const CLEAN_ID = "ds_als_survival_motorneuron_v1";
const ALS_STUDY = "Predict survival from baseline FVC and age at onset";

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
  {
    id: "curated_buy",
    title: "Buy a curated listing",
    caption:
      "A second study, on synthetic ALS data. The sample is screened first and looks clean, so the buyer approves and the payment is held.",
  },
  {
    id: "audit_fail",
    title: "The delivery fails its audit",
    caption:
      "The vendor delivers. The delivered rows are checked against what the listing claimed. They break claims, so the payment stays held and a dispute opens for a person.",
  },
  {
    id: "arbiter",
    title: "An arbiter sees the evidence",
    caption:
      "The arbiter reads the audit findings and advises. It never moves money. A person decides.",
  },
  {
    id: "clean_pass",
    title: "A clean listing passes",
    caption:
      "A different listing, bought the same way. Its delivered rows match its claims, so the audit passes and the normal release goes ahead.",
  },
  {
    id: "survival",
    title: "Does the arm gap hold up?",
    caption:
      "Back on the held order, the buyer reads the evidence and keeps the data on purpose. Then one survival question: the arms look different, until age is held fixed.",
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
  /** The held order from the curated ALS listing. */
  curatedOrderId?: string;
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
  /** A survival answer for the page to chart. Synthetic data. */
  analysis?: SurvivalAnalysis;
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

/** Like call, but a refusal is a result the story expects to show, not an error. */
async function tryCall(
  f: Fetcher,
  label: string,
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown,
): Promise<{ status: number; data: Json }> {
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
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** Screen a listing's sample, buy it and hold the payment. */
async function buyAlsListing(
  f: Fetcher,
  datasetId: string,
): Promise<{ orderId: string; verdict: string; checks: number; held: number }> {
  const screen = await call(f, "Fitness screen", "POST", "/api/match", {
    fitnessCheck: datasetId,
    description: ALS_STUDY,
  });
  const report = screen.fitnessCheck;
  if (!report)
    throw new StoryError(`Fitness screen: ${datasetId} has no rows to screen.`);
  if (report.verdict === "fail")
    throw new StoryError(
      `Fitness screen: the sample of ${datasetId} failed, so the story will not buy it.`,
    );
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
  return {
    orderId,
    verdict: String(report.verdict),
    checks: Array.isArray(report.findings) ? report.findings.length : 0,
    held: read.order.amount_cents,
  };
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

    case "curated_buy": {
      const bought = await buyAlsListing(f, CURATED_ID);
      return {
        ctx: { ...ctx, curatedOrderId: bought.orderId },
        facts: [
          { label: "Listing", value: `${CURATED_ID} (SYNTHETIC)` },
          {
            label: "Sample screen",
            value: `${bought.verdict}, ${bought.checks} checks. A screen, not proof.`,
          },
          { label: "State", value: "AUTHORIZED", tone: "held" },
          { label: "Held in escrow", value: usd(bought.held), tone: "held" },
        ],
      };
    }

    case "audit_fail": {
      const orderId = need(ctx.curatedOrderId, "the curated order");
      const delivered = await call(f, "Deliver", "PATCH", "/api/orders", {
        orderId,
        action: "deliver",
      });
      if (!delivered.audit?.blocking)
        throw new StoryError(
          "Deliver: the curated listing was expected to fail its audit and did not.",
        );
      const audit = await call(
        f,
        "Read audit",
        "GET",
        `/api/orders?id=${encodeURIComponent(orderId)}&audit=1`,
      );
      const broken: { title: string; reason: string }[] = (
        audit.audit?.report?.findings ?? []
      ).filter(
        (x: { id?: string; severity?: string }) =>
          x.id === "claim" && x.severity === "fail",
      );
      // A release is refused while the audit holds the payment.
      const release = await tryCall(
        f,
        "Release attempt",
        "PATCH",
        "/api/orders",
        {
          orderId,
          action: "capture",
        },
      );
      if (release.status < 400)
        throw new StoryError(
          "Release attempt: the payment was released while the audit blocked it.",
        );
      const read = await call(
        f,
        "Read order",
        "GET",
        `/api/orders?id=${encodeURIComponent(orderId)}`,
      );
      return {
        ctx,
        facts: [
          {
            label: "Audit",
            value: `${delivered.audit.verdict}, claims broken, payment held`,
          },
          ...broken.slice(0, 2).map((b) => ({
            label: "Broken claim",
            value: `${b.title}. ${b.reason}`,
          })),
          {
            label: "Release attempt",
            value: `Refused (${release.status}): ${release.data?.error ?? "not allowed"}`,
          },
          { label: "State", value: read.order.status, tone: "held" as const },
          {
            label: "Still held",
            value: usd(read.order.amount_cents),
            tone: "held" as const,
          },
        ],
      };
    }

    case "arbiter": {
      const orderId = need(ctx.curatedOrderId, "the curated order");
      const data = await call(
        f,
        "Arbiter",
        "GET",
        `/api/orders?id=${encodeURIComponent(orderId)}&arbitrate=1`,
      );
      const rec = data.recommendation;
      if (!rec) throw new StoryError("Arbiter: no recommendation came back.");
      const evidence: string[] = Array.isArray(rec.evidence)
        ? rec.evidence
        : [];
      return {
        ctx,
        facts: [
          {
            label: "Advice",
            value: `${rec.outcome} (confidence ${Number(rec.confidence).toFixed(2)})`,
          },
          { label: "Why", value: String(rec.rationale) },
          ...evidence
            .filter((e) =>
              /delivery audit|below the listing|post-index|claim/i.test(e),
            )
            .slice(0, 3)
            .map((e) => ({ label: "Evidence", value: e })),
          { label: "Money moved", value: "none. The arbiter only advises." },
          { label: "State", value: data.order.status, tone: "held" as const },
        ],
      };
    }

    case "clean_pass": {
      const bought = await buyAlsListing(f, CLEAN_ID);
      const delivered = await call(f, "Deliver", "PATCH", "/api/orders", {
        orderId: bought.orderId,
        action: "deliver",
      });
      if (delivered.audit?.blocking)
        throw new StoryError("Deliver: the clean listing failed its audit.");
      await call(f, "Capture", "PATCH", "/api/orders", {
        orderId: bought.orderId,
        action: "capture",
      });
      await call(f, "Payout", "PATCH", "/api/orders", {
        orderId: bought.orderId,
        action: "payout",
      });
      const read = await call(
        f,
        "Receipt",
        "GET",
        `/api/orders?id=${encodeURIComponent(bought.orderId)}&receipt=1`,
      );
      return {
        ctx,
        facts: [
          { label: "Listing", value: `${CLEAN_ID} (SYNTHETIC)` },
          {
            label: "Sample screen",
            value: `${bought.verdict}, ${bought.checks} checks`,
          },
          {
            label: "Delivery audit",
            value: `${delivered.audit?.verdict ?? "none"}, nothing holds payment`,
          },
          {
            label: "State",
            value: read.receipt.status,
            tone: "released" as const,
          },
          {
            label: "Vendor paid",
            value: usd(read.receipt.vendorPayoutCents),
            tone: "released" as const,
          },
        ],
      };
    }

    case "survival": {
      const orderId = need(ctx.curatedOrderId, "the curated order");
      // Dropping the dispute is how a buyer keeps flagged data. A person chooses.
      await call(f, "Keep the data", "PATCH", "/api/orders", {
        orderId,
        action: "resolve",
        resolution: "capture",
        note: "Keeping the data on purpose to check the arm gap.",
      });
      const data = await call(f, "Survival", "POST", "/api/query", {
        orderId,
        datasetId: CURATED_ID,
        analysis: { type: "survival", groupBy: "arm" },
      });
      const a: SurvivalAnalysis | undefined = data.analysis;
      if (!a?.logRank?.adjusted)
        throw new StoryError("Survival: no age-adjusted result came back.");
      // The p-values and the reading are shown by the survival panel below.
      return {
        ctx,
        analysis: a,
        facts: [
          {
            label: "Decision",
            value: "The buyer keeps the data. A person chose, not the audit.",
          },
          { label: "Metered", value: usd(data.usage?.chargeCents ?? 0) },
        ],
      };
    }
  }
}
