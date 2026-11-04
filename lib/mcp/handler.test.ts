import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";

import { revokeMandate, saveMandate } from "../agent/mandate-store";
import { withAgentDb } from "../agent/test-db";
import { issueMandate } from "../agent/mandate";
import { listOrders, withDb } from "../db/client";
import {
  createSession,
  handleLine,
  handleMessage,
  MCP_TOOLS,
  type RpcResponse,
} from "./handler";
import { serveStdio } from "./stdio";

const CARDIO = "ds_cardio_synthea_v1"; // 4900 cents
const STUDY = "Cardiology outcomes in a synthetic cohort";

function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, ...(params ? { params } : {}) };
}

async function call(
  session: ReturnType<typeof createSession>,
  name: string,
  args: unknown,
) {
  const res = (await handleMessage(
    session,
    rpc("tools/call", { name, arguments: args }),
  )) as Extract<RpcResponse, { result: unknown }>;
  const r = res.result as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
  return {
    isError: r.isError === true,
    text: r.content[0].text,
    data: JSON.parse(r.content[0].text) as Record<string, unknown>,
  };
}

function token(extra: Record<string, unknown> = {}) {
  return issueMandate({
    buyerId: "researcher@example.com",
    maxTotalCents: 10_000,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    ...extra,
  }).token;
}

test("initialize negotiates the protocol and advertises tools", async () => {
  const res = await handleMessage(
    createSession(),
    rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    }),
  );
  assert.deepEqual(res, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "meddata-escrow", version: "0.1.0" },
    },
  });
});

test("notifications get no response; ping is answered", async () => {
  const s = createSession();
  assert.equal(
    await handleMessage(s, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
    null,
  );
  assert.deepEqual(await handleMessage(s, rpc("ping", undefined, "p")), {
    jsonrpc: "2.0",
    id: "p",
    result: {},
  });
});

test("tools/list exposes the four tools with JSON schemas", async () => {
  const res = (await handleMessage(createSession(), rpc("tools/list"))) as {
    result: { tools: { name: string; inputSchema: { type: string } }[] };
  };
  assert.deepEqual(
    res.result.tools.map((t) => t.name),
    ["search_datasets", "sample_check", "place_escrow_order", "get_order"],
  );
  assert.equal(res.result.tools.length, MCP_TOOLS.length);
  for (const t of res.result.tools) assert.equal(t.inputSchema.type, "object");
});

test("protocol errors use the JSON-RPC codes", async () => {
  const s = createSession();
  const code = async (m: unknown) =>
    ((await handleMessage(s, m)) as { error: { code: number } }).error.code;
  assert.equal(await code(rpc("nope")), -32601);
  assert.equal(await code({ jsonrpc: "1.0", id: 1, method: "ping" }), -32600);
  assert.equal(await code("hello"), -32600);
  assert.equal(await code([]), -32600);
  assert.equal(await code(rpc("tools/call", { arguments: {} })), -32602);
  assert.equal(await code(rpc("tools/call", { name: "nope" })), -32602);

  const parse = (await handleLine(s, "{not json")) as {
    id: null;
    error: { code: number };
  };
  assert.equal(parse.error.code, -32700);
  assert.equal(parse.id, null);
  assert.equal(await handleLine(s, "   "), null);
});

test(
  "search_datasets and sample_check run the real domain code",
  withAgentDb(async () => {
    const s = createSession();
    const search = await call(s, "search_datasets", { study: STUDY });
    assert.equal(search.isError, false);
    const matches = search.data.matches as { datasetId: string }[];
    assert.equal(matches[0].datasetId, CARDIO);

    const sample = await call(s, "sample_check", {
      datasetId: CARDIO,
      study: STUDY,
    });
    assert.equal(sample.isError, false);
    assert.equal(sample.data.passed, true);

    const bad = await call(s, "sample_check", {
      datasetId: "ds_nope",
      study: STUDY,
    });
    assert.equal(bad.isError, true);
  }),
);

test(
  "place_escrow_order requires a valid mandate",
  withAgentDb(async () => {
    const s = createSession();
    await call(s, "sample_check", { datasetId: CARDIO, study: STUDY });
    const missing = await call(s, "place_escrow_order", { datasetId: CARDIO });
    assert.equal(missing.isError, true);
    const forged = await call(s, "place_escrow_order", {
      datasetId: CARDIO,
      mandate: "abc.def",
    });
    assert.equal(forged.isError, true);
    assert.match(forged.text, /mandate/);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "place_escrow_order buys inside the mandate and get_order reads it back",
  withAgentDb(async () => {
    const s = createSession();
    await call(s, "sample_check", { datasetId: CARDIO, study: STUDY });
    const bought = await call(s, "place_escrow_order", {
      datasetId: CARDIO,
      mandate: token({ allowedTags: ["cardiology"] }),
      justification: "fits the study",
    });
    assert.equal(bought.isError, false, bought.text);
    assert.equal(bought.data.escrowState, "MATCHED");
    assert.equal(bought.data.amountCents, 4900);
    assert.match(String(bought.data.approveUrl), /checkout\/mock/);
    assert.equal(
      (bought.data.mandate as { spentCents: number }).spentCents,
      4900,
    );

    const order = await call(s, "get_order", { orderId: bought.data.orderId });
    assert.equal(order.isError, false);
    assert.equal(order.data.status, "MATCHED");
    assert.equal(order.data.datasetId, CARDIO);
    assert.equal(order.data.amountCents, 4900);

    const missing = await call(s, "get_order", { orderId: "ord_nope" });
    assert.equal(missing.isError, true);
  }),
);

test(
  "place_escrow_order refuses without a passing sample check in the session",
  withAgentDb(async () => {
    const r = await call(createSession(), "place_escrow_order", {
      datasetId: CARDIO,
      mandate: token(),
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /sample check/);
  }),
);

test(
  "place_escrow_order refuses anything outside the mandate",
  withAgentDb(async () => {
    const s = createSession();
    await call(s, "sample_check", { datasetId: CARDIO, study: STUDY });
    const r = await call(s, "place_escrow_order", {
      datasetId: CARDIO,
      mandate: token({ maxPerOrderCents: 1000 }),
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /mandate denied.*per-order/);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "the mandate total holds across several MCP orders",
  withAgentDb(async () => {
    const s = createSession();
    const t = token({ maxTotalCents: 6000 });
    await call(s, "sample_check", { datasetId: CARDIO, study: STUDY });
    assert.equal(
      (await call(s, "place_escrow_order", { datasetId: CARDIO, mandate: t }))
        .isError,
      false,
    );
    const other = "ds_diabetes_synthea_v1";
    await call(s, "sample_check", {
      datasetId: other,
      study: "Type 2 diabetes outcomes in a synthetic cohort",
    });
    const second = await call(s, "place_escrow_order", {
      datasetId: other,
      mandate: t,
    });
    assert.equal(second.isError, true);
    assert.match(second.text, /remaining/);
  }),
);

test(
  "place_escrow_order refuses a revoked mandate",
  withAgentDb(async () => {
    const issued = issueMandate({
      buyerId: "researcher@example.com",
      maxTotalCents: 10_000,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await saveMandate(issued.mandate);
    await revokeMandate(issued.mandate.id, issued.mandate.buyerId);
    const s = createSession();
    await call(s, "sample_check", { datasetId: CARDIO, study: STUDY });
    const r = await call(s, "place_escrow_order", {
      datasetId: CARDIO,
      mandate: issued.token,
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /revoked/);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test("bad tool arguments are tool errors, not protocol errors", async () => {
  const r = await call(createSession(), "search_datasets", { study: 5 });
  assert.equal(r.isError, true);
});

test("a database failure in get_order is a tool error, not a crash", async () => {
  const saved = process.env.DATABASE_URL;
  // A directory is not a database file, so opening it throws.
  process.env.DATABASE_URL = tmpdir();
  const logged = console.error;
  console.error = () => {};
  try {
    const r = await call(createSession(), "get_order", { orderId: "ord_x" });
    assert.equal(r.isError, true);
    assert.equal(r.data.error, "tool failed unexpectedly");
  } finally {
    console.error = logged;
    if (saved === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved;
  }
});

test("serveStdio frames one JSON message per line", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = serveStdio(input, output, createSession());
  input.write(JSON.stringify(rpc("ping")) + "\n");
  input.write("{bad\n");
  input.write(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
      "\n",
  );
  input.end();
  await done;
  const lines = output.read().toString().trim().split("\n");
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]).result, {});
  assert.equal(JSON.parse(lines[1]).error.code, -32700);
});

test(
  "place_escrow_order refuses a dataset whose sample failed the fitness audit and names the audit",
  withAgentDb(async () => {
    const s = createSession();
    const checked = await call(s, "sample_check", {
      datasetId: "ds_als_survival_axonpoint_v1",
      study: "Predict survival from baseline FVC and age at onset in ALS",
    });
    assert.equal(checked.isError, false, checked.text);
    assert.equal(checked.data.passed, false);
    assert.equal(
      (checked.data.audit as { verdict: string }).verdict,
      "fail",
    );
    const r = await call(s, "place_escrow_order", {
      datasetId: "ds_als_survival_axonpoint_v1",
      mandate: token(),
    });
    assert.equal(r.isError, true);
    assert.match(r.text, /fitness audit/i);
    assert.equal(withDb((db) => listOrders(db)).length, 0);
  }),
);

test(
  "place_escrow_order buys a clean ALS listing after its audit passes",
  withAgentDb(async () => {
    const s = createSession();
    const checked = await call(s, "sample_check", {
      datasetId: "ds_als_survival_motorneuron_v1",
      study: "Predict survival from baseline FVC and age at onset in ALS",
    });
    assert.equal(checked.data.passed, true);
    const r = await call(s, "place_escrow_order", {
      datasetId: "ds_als_survival_motorneuron_v1",
      mandate: token(),
    });
    assert.equal(r.isError, false, r.text);
  }),
);
