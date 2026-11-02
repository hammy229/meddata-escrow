import { test } from "node:test";
import assert from "node:assert/strict";

import { transaction, type AppDatabase } from "./connection";

function fakeDb(failRollback: boolean) {
  const ran: string[] = [];
  const db: AppDatabase = {
    dialect: "postgres",
    prepare: () => {
      throw new Error("unused");
    },
    exec: async (sql) => {
      ran.push(sql);
      if (sql === "ROLLBACK" && failRollback)
        throw new Error("connection lost");
    },
  };
  return { db, ran };
}

test("a failed ROLLBACK does not hide the error that caused it", async () => {
  const { db, ran } = fakeDb(true);
  await assert.rejects(
    transaction(db, async () => {
      throw new Error("order not found");
    }),
    /order not found/,
  );
  assert.deepEqual(ran, ["BEGIN", "ROLLBACK"]);
});

test("a successful transaction commits once", async () => {
  const { db, ran } = fakeDb(false);
  assert.equal(await transaction(db, async () => 7), 7);
  assert.deepEqual(ran, ["BEGIN", "COMMIT"]);
});
