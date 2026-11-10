// Happy-path demo: match -> sample check -> escrow -> deliver -> capture -> payout.
//
//   npm run demo                  # mock mode (no creds, no network)
//   npm run demo -- --sandbox     # real sandbox order (needs .env.local)
//   npm run demo -- --sandbox --resume <orderId>   # finish it after approval
//   npm run demo -- "heart disease cohort"   # custom study description
//
// The demo drives the SAME code the app runs — the matcher, the sample check,
// and the escrow service (lib/escrow/service) with its state machine, audit
// trail and PayPal client — against a freshly seeded scratch SQLite database,
// so it never touches data/dev.sqlite. Mock mode completes the whole arc
// offline. --sandbox creates a real PayPal sandbox order and stops at the
// approve URL: authorizing needs the buyer to approve it in PayPal first.
// Sandbox runs keep their database in data/sandbox-demo.sqlite, so once the
// buyer has approved, `--resume <orderId>` walks authorize -> deliver ->
// capture -> payout against the sandbox. SANDBOX_PAYOUT_EMAIL, if set, is
// where the vendor payout goes (a sandbox account you can log in to).
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { matchDatasets } from "../lib/ai/matcher";
import { checkSample } from "../lib/ai/sample-check";
import { mockDeliveryUrl } from "../lib/delivery/mock-s3";
import { listOrderEvents, openDb, withDb } from "../lib/db/client";
import { seedDatabase } from "../lib/db/seed";
import {
  advanceEscrowOrder,
  createEscrowOrder,
  type EscrowAction,
} from "../lib/escrow/service";

async function main() {
  const args = process.argv.slice(2);
  const sandbox = args.includes("--sandbox");
  const resumeAt = args.indexOf("--resume");
  const resumeId = resumeAt >= 0 ? args[resumeAt + 1] : undefined;
  if (resumeAt >= 0 && (!sandbox || !resumeId)) {
    throw new Error("--resume <orderId> only works with --sandbox");
  }
  const description =
    args.find((a, i) => !a.startsWith("--") && i !== resumeAt + 1) ??
    "cardiovascular disease patient cohort";

  // Database + mode, set before any DB or PayPal call reads the env. Mock runs
  // use a throwaway database; sandbox runs keep one so --resume can find the
  // order after the buyer approves it in PayPal.
  if (sandbox) {
    mkdirSync("data", { recursive: true });
    process.env.DATABASE_URL = "file:./data/sandbox-demo.sqlite";
    // .env.local may say PAYPAL_MODE=mock for demos; --sandbox means real.
    delete process.env.PAYPAL_MODE;
  } else {
    const dir = mkdtempSync(join(tmpdir(), "meddata-demo-"));
    process.env.DATABASE_URL = `file:${join(dir, "demo.sqlite")}`;
    process.env.PAYPAL_MODE = "mock";
  }
  const db = openDb();
  seedDatabase(db);
  const payoutEmail = process.env.SANDBOX_PAYOUT_EMAIL?.trim();
  if (sandbox && payoutEmail) {
    db.prepare("UPDATE vendors SET payout_email = ?").run(payoutEmail);
  }
  db.close();

  if (resumeId) {
    console.log(`\nMedData Escrow happy-path  (SANDBOX mode, resuming)`);
    await walkArc(resumeId, ["authorize", "deliver", "capture", "payout"]);
    return;
  }

  console.log(
    `\nMedData Escrow happy-path  (${sandbox ? "SANDBOX" : "mock"} mode)`,
  );
  console.log(`Study: "${description}"\n`);

  // 1. Match the study to a catalog dataset.
  const [top] = await matchDatasets(description);
  console.log(
    `Matched ${top.datasetId}  (score ${top.score}: ${top.rationale})`,
  );

  // 2. Check a sample before any money is held.
  const sample = await checkSample(top.datasetId, {
    studyDescription: description,
  });
  console.log(
    `Sample check: ${sample.passed ? "PASSED" : "FAILED"} (score ${sample.score}, ${sample.source})`,
  );
  if (!sample.passed) {
    console.log(`  Findings: ${sample.findings.join("; ")}`);
    console.log("\nNot buying a dataset that failed its sample check.\n");
    return;
  }

  // 3. Open the escrow order at the dataset's listed price.
  const order = await createEscrowOrder({ datasetId: top.datasetId });
  console.log(
    `\nOrder ${order.orderId} (${order.escrowState}), PayPal ${order.paypalOrderId}`,
  );
  if (sandbox) {
    console.log(`Buyer approves here, then authorize: ${order.approveUrl}\n`);
    return;
  }

  // 4. Walk the escrow arc through the service, exactly as the API does.
  await walkArc(order.orderId, ["authorize", "deliver", "capture", "payout"]);
}

async function walkArc(orderId: string, arc: EscrowAction[]) {
  for (const action of arc) {
    const res = await advanceEscrowOrder({ orderId, action });
    const detail =
      action === "deliver"
        ? `delivery=${mockDeliveryUrl(res.order.dataset_id).slice(0, 48)}...`
        : (res.authorizationId ?? res.captureId ?? res.payoutBatchId ?? "");
    console.log(
      `  ${action.padEnd(9)} -> ${res.escrowState.padEnd(10)} ${detail}`,
    );
  }

  // 5. Print the append-only audit trail the order accumulated.
  const events = withDb((d) => listOrderEvents(d, orderId));
  console.log(`\nAudit trail (${events.length} events):`);
  for (const e of events) {
    console.log(
      `  #${e.seq} ${e.event.padEnd(9)} ${e.from_state ?? "-"} -> ${e.to_state}`,
    );
  }
  console.log(
    `\nDone. Final escrow state: ${events[events.length - 1].to_state}\n`,
  );
}

main().catch((err) => {
  console.error(
    "\nhappy-path failed:",
    err instanceof Error ? err.message : err,
  );
  process.exitCode = 1;
});
