// Happy-path demo: request -> match -> authorize -> deliver -> capture -> payout.
//
//   npm run demo                  # mock mode (no creds, no network)
//   npm run demo -- --sandbox     # real sandbox calls (needs .env.local)
//   npm run demo -- "heart disease cohort"   # custom study description
//
// Mock mode drives the REAL escrow state machine and matcher against a stubbed
// PayPal client, so the full loop is exercised offline. --sandbox swaps in the
// real Orders v2 client; note the authorize step needs buyer approval of the
// order (the approve URL is printed) — automated in the AI-Toolkit/MCP session.
import { randomUUID } from "node:crypto";

import { transition, type EscrowState } from "../lib/escrow/state-machine";
import { matchDatasets } from "../lib/ai/matcher";
import { mockDeliveryUrl } from "../lib/delivery/mock-s3";
import {
  payPalClientFromEnv,
  type CreateOrderResult,
  type AuthorizeResult,
  type CaptureResult,
} from "../lib/paypal/client";

// Result of releasing escrowed funds to the vendor (PayPal Payouts shape).
interface PayoutResult {
  payoutBatchId: string;
  status: string;
}

// Minimal shape the demo needs — satisfied by the real client and the mock.
interface EscrowPayPal {
  createAuthorizeOrder(i: {
    amount: number;
    currency?: string;
    referenceId?: string;
  }): Promise<CreateOrderResult>;
  authorizeOrder(orderId: string): Promise<AuthorizeResult>;
  captureAuthorization(
    authId: string,
    o?: { requestId?: string },
  ): Promise<CaptureResult>;
  // Release captured funds to the dataset vendor. Mock here; the real PayPal
  // Payouts call drops in behind this same method (see sandboxPayPal / the
  // "real PayPal Payouts goes here" seam) without touching the loop below.
  payoutToVendor(i: {
    amount: number;
    currency?: string;
    receiver?: string;
  }): Promise<PayoutResult>;
}

function mockPayPal(): EscrowPayPal {
  return {
    async createAuthorizeOrder() {
      return {
        orderId: "MOCK-ORDER-1",
        status: "CREATED",
        approveUrl: "https://sandbox.paypal.com/checkoutnow?token=MOCK-ORDER-1",
      };
    },
    async authorizeOrder(orderId) {
      return { orderId, authorizationId: "MOCK-AUTH-1", status: "CREATED" };
    },
    async captureAuthorization(_authId) {
      return { captureId: "MOCK-CAP-1", status: "COMPLETED" };
    },
    async payoutToVendor() {
      return { payoutBatchId: "MOCK-PAYOUT-1", status: "PENDING" };
    },
  };
}

// Sandbox adapter: the real Orders v2 client covers create/authorize/capture,
// but has no Payouts method yet. We wrap it and supply a payout seam so the
// interface is satisfied and real PayPal Payouts can drop in here later.
function sandboxPayPal(): EscrowPayPal {
  const client = payPalClientFromEnv();
  return {
    createAuthorizeOrder: (i) => client.createAuthorizeOrder(i),
    authorizeOrder: (id) => client.authorizeOrder(id),
    captureAuthorization: (id, o) => client.captureAuthorization(id, o),
    async payoutToVendor() {
      // real PayPal Payouts goes here (POST /v1/payments/payouts via the client).
      throw new Error(
        "PayPal Payouts not implemented for --sandbox yet (mock mode reaches PAID_OUT).",
      );
    },
  };
}

let state: EscrowState = "MATCHED";
function step(event: Parameters<typeof transition>[1], note: string) {
  state = transition(state, event);
  console.log(`  [${event.padEnd(9)}] -> ${state.padEnd(10)} ${note}`);
}

async function main() {
  const args = process.argv.slice(2);
  const sandbox = args.includes("--sandbox");
  const description =
    args.find((a) => !a.startsWith("--")) ??
    "cardiovascular disease patient cohort";

  console.log(
    `\nMedData Escrow happy-path  (${sandbox ? "SANDBOX" : "mock"} mode)`,
  );
  console.log(`Study: "${description}"\n`);

  // 1. Match (mock Bedrock ranker over the local catalog).
  const ranked = await matchDatasets(description);
  const top = ranked[0];
  console.log(
    `Matched dataset: ${top.datasetId}  (score ${top.score} — ${top.rationale})`,
  );

  const pp: EscrowPayPal = sandbox ? sandboxPayPal() : mockPayPal();
  const amount = 49.0; // demo price (USD)

  // 2. Create order (intent=AUTHORIZE) and authorize funds into escrow.
  const order = await pp.createAuthorizeOrder({
    amount,
    referenceId: `study-${Date.now()}`,
  });
  console.log(`\nOrder ${order.orderId} created (${order.status}).`);
  if (sandbox) {
    console.log(`Buyer must approve first: ${order.approveUrl}`);
    console.log(
      "(Sandbox authorize requires approval — finish via the PayPal MCP/test accounts.)",
    );
  }
  const auth = await pp.authorizeOrder(order.orderId);
  step("AUTHORIZE", `authorizationId=${auth.authorizationId}`);

  // 3. Deliver the dataset (mock presigned URL).
  const url = mockDeliveryUrl(top.datasetId);
  step("DELIVER", `delivery=${url.slice(0, 60)}...`);

  // 4. Buyer confirms within the window -> capture the held funds.
  const cap = await pp.captureAuthorization(auth.authorizationId, {
    requestId: randomUUID(),
  });
  step("CAPTURE", `captureId=${cap.captureId} (${cap.status})`);

  // 5. Release the captured funds to the vendor (mock PayPal Payouts).
  const payout = await pp.payoutToVendor({ amount, currency: "USD" });
  step("PAYOUT", `payoutBatchId=${payout.payoutBatchId} (${payout.status})`);

  console.log(`\nDone. Final escrow state: ${state}\n`);
}

main().catch((err) => {
  console.error(
    "\nhappy-path failed:",
    err instanceof Error ? err.message : err,
  );
  process.exitCode = 1;
});
