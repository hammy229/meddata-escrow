// A model reply can carry many tool_use blocks. Only the first few run;
// the rest get an error result so the transcript stays valid.
import { test } from "node:test";
import assert from "node:assert/strict";

import { hostileModel } from "../eval/redteam-model";
import { withAgentDb } from "./test-db";
import { MAX_TOOL_CALLS_PER_TURN, runProcurementAgent } from "./run";

test(
  "tool calls beyond the per-turn cap are refused, not run",
  withAgentDb(async () => {
    const burst = Array.from({ length: 50 }, () => ({
      name: "search_datasets",
      input: { study: "cardiology" },
    }));
    const { client, requests } = hostileModel([burst, { text: "done" }]);
    const r = await runProcurementAgent(
      { study: "cardiology", budgetCents: 5000 },
      { client, useLlm: true },
    );
    assert.equal(r.steps.length, MAX_TOOL_CALLS_PER_TURN);
    // every tool_use still gets a tool_result, the extras marked as errors
    const results = requests[1].messages.at(-1)!.content as {
      type: string;
      is_error?: boolean;
      content: string;
    }[];
    assert.equal(results.length, 50);
    const refused = results.filter((b) => b.is_error);
    assert.equal(refused.length, 50 - MAX_TOOL_CALLS_PER_TURN);
    assert.match(refused[0].content, /too many tool calls/);
  }),
);

test(
  "a normal turn is not affected by the cap",
  withAgentDb(async () => {
    const { client } = hostileModel([
      [
        { name: "search_datasets", input: { study: "cardiology" } },
        { name: "get_dataset", input: { datasetId: "ds_cardio_synthea_v1" } },
      ],
      { text: "done" },
    ]);
    const r = await runProcurementAgent(
      { study: "cardiology", budgetCents: 5000 },
      { client, useLlm: true },
    );
    assert.equal(r.steps.length, 2);
  }),
);
