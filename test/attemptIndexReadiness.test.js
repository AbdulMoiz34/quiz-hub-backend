import assert from "node:assert/strict";
import test from "node:test";
import { inspectAttemptIndexes, assertAttemptIndexesReady } from "../src/utils/attemptIndexReadiness.js";

const id = { name: "_id_", key: { _id: 1 }, unique: true };
const email = {
  name: "quiz_1_email_1", key: { quiz: 1, email: 1 },
  unique: true, partialFilterExpression: { email: { $type: "string" } },
};
const other = { name: "quiz_1__id_-1", key: { quiz: 1, _id: -1 } };

test("only valid email uniqueness with no other unique constraints can serve candidates", async () => {
  const state = inspectAttemptIndexes([id, email, other]);
  assert.equal(state.ready, true);
  assert.deepEqual(state.blockingUniqueIndexNames, []);
  await assertAttemptIndexesReady({ indexes: async () => [id, email, other] });
});

test("old unique roll-number indexes reject new email-only candidates", async () => {
  const old = { name: "quiz_1_rollNo_1", key: { quiz: 1, rollNo: 1 }, unique: true };
  const state = inspectAttemptIndexes([id, email, old]);
  assert.equal(state.emailUniqueIndexReady, true);
  assert.equal(state.ready, false);
  assert.deepEqual(state.blockingUniqueIndexNames, ["quiz_1_rollNo_1"]);
  const log = console.error;
  console.error = () => {};
  try {
    await assert.rejects(
      assertAttemptIndexesReady({ indexes: async () => [id, email, old] }),
      /unsafe.*migration procedure/
    );
  } finally { console.error = log; }
});

test("unknown unique constraints and incorrect email indexes fail closed", () => {
  assert.equal(inspectAttemptIndexes([id, other]).ready, false);
  assert.equal(inspectAttemptIndexes([id, { ...email, partialFilterExpression: null }]).ready, false);
  const odd = { name: "legacy_unique", key: { quiz: 1, slot: 1 }, unique: true };
  assert.deepEqual(inspectAttemptIndexes([id, email, odd]).blockingUniqueIndexNames, ["legacy_unique"]);
});
