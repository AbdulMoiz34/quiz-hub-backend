import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { startAttemptSchema } from "../src/validations/attempt.validation.js";
import { Attempt } from "../src/models/attempt.model.js";
import { Quiz } from "../src/models/quiz.model.js";
import { studentQuestions } from "../src/utils/studentQuestions.js";
import { generateAttemptJwt } from "../src/utils/generateJwt.js";

const origin = "http://localhost:5173";
const secret = "unique-testing-secret-over-32-characters-and-more";
const quizId = new mongoose.Types.ObjectId().toString();
const attemptId = new mongoose.Types.ObjectId();
const startKey = randomUUID();
const candidate = {
  quizId, studentName: "Ahmed Ali", email: "Ahmed@Example.test",
  phone: "03001234567", startKey,
};

async function withServer(callback) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret, nodeEnv: "test",
    cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}
const post = (base, body) => fetch(base + "/api/v1/student/attempts/start", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("email is normalized and phone/name are required", () => {
  const { error, value } = startAttemptSchema.validate(candidate);
  assert.equal(error, undefined);
  assert.equal(value.email, "ahmed@example.test");
  for (const patch of [{ email: "bad" }, { phone: "" },
    { phone: "0311111122" }, { phone: "031111112222" },
    { phone: "04111111222" }, { phone: "+923111111222" },
    { phone: "0311111122a" }, { studentName: "" },
    { startKey: "not-uuid" }, { rollNo: "123" }]) {
    assert.ok(startAttemptSchema.validate({ ...candidate, ...patch }).error);
  }
});

test("one email per quiz is guarded by a unique partial database index", () => {
  const found = Attempt.schema.indexes().find(([index]) =>
    index.quiz === 1 && index.email === 1);
  assert.ok(found);
  assert.equal(found[1].unique, true);
  assert.deepEqual(found[1].partialFilterExpression, { email: { $type: "string" } });
  assert.ok(!Attempt.schema.path("slot"));
  assert.ok(!Attempt.schema.path("rollNo"));
});

test("invalid registration rejected before database access", async () => {
  await withServer(async (base) => {
    const response = await post(base, { ...candidate, email: "invalid" });
    assert.equal(response.status, 400);
    const wrongPhone = await post(base, { ...candidate, phone: "0311111122" });
    assert.equal(wrongPhone.status, 400);
    assert.equal((await wrongPhone.json()).message, "Invalid request body");
    const international = await post(base, { ...candidate, phone: "+923111111222" });
    assert.equal(international.status, 400);
  });
});

test("start is idempotent but a second key for same email receives 409", async () => {
  const original = { find: Attempt.findOne, create: Attempt.create, quiz: Quiz.findOne };
  let saved = null;
  let writes = 0;
  Attempt.findOne = ({ quiz, email }) => ({
    select: async () => String(quiz) === quizId && email === saved?.email ? saved : null,
  });
  Quiz.findOne = () => ({ select: async () => ({ durationMinutes: 60 }) });
  Attempt.create = async (doc) => {
    writes++;
    saved = { _id: attemptId, ...doc, status: "started", violationCount: 0 };
    return saved;
  };
  try {
    await withServer(async (base) => {
      const first = await post(base, candidate);
      assert.equal(first.status, 200);
      const firstBody = (await first.json()).data;
      assert.equal(firstBody.email, "ahmed@example.test");
      assert.equal(firstBody.phone, "03001234567");
      assert.equal(Date.parse(firstBody.expiresAt) - Date.parse(firstBody.startedAt), 60 * 60_000);
      assert.match(first.headers.get("set-cookie"), /HttpOnly/);
      assert.equal(writes, 1);

      const retry = await post(base, candidate);
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).data.id, String(attemptId));
      assert.equal(writes, 1);

      const duplicate = await post(base, { ...candidate, startKey: randomUUID() });
      assert.equal(duplicate.status, 409);
      assert.equal(writes, 1);
      assert.equal(saved.startKeyHash, createHash("sha256").update(startKey).digest("hex"));
    });
  } finally {
    Attempt.findOne = original.find; Attempt.create = original.create; Quiz.findOne = original.quiz;
  }
});

test("server handles an atomic insert collision by returning its winner", async () => {
  const orig = { find: Attempt.findOne, create: Attempt.create, quiz: Quiz.findOne };
  let calls = 0;
  const winner = {
    _id: attemptId, quiz: quizId, email: "ahmed@example.test",
    studentName: "Ahmed Ali", phone: "03001234567",
    startKeyHash: createHash("sha256").update(startKey).digest("hex"),
    startedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000), status: "started",
  };
  Attempt.findOne = () => ({ select: async () => (++calls === 1 ? null : winner) });
  Quiz.findOne = () => ({ select: async () => ({ durationMinutes: 60 }) });
  Attempt.create = async () => { const error = new Error("collision"); error.code = 11000; throw error; };
  try {
    await withServer(async (base) => {
      const res = await post(base, candidate);
      assert.equal(res.status, 200);
      assert.equal((await res.json()).data.id, String(attemptId));
    });
  } finally {
    Attempt.findOne = orig.find; Attempt.create = orig.create; Quiz.findOne = orig.quiz;
  }
});

test("unexpected unique index is a service issue, not a duplicate-email response", async () => {
  const orig = { find: Attempt.findOne, create: Attempt.create, quiz: Quiz.findOne };
  Attempt.findOne = () => ({ select: async () => null });
  Quiz.findOne = () => ({ select: async () => ({ durationMinutes: 60 }) });
  Attempt.create = async () => { const error = new Error("unexpected index collision"); error.code = 11000; throw error; };
  const oldLog = console.error;
  console.error = () => {};
  try {
    await withServer(async (base) => {
      const response = await post(base, candidate);
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "60");
      assert.match((await response.json()).message, /temporarily unavailable/);
    });
  } finally {
    Object.assign(Attempt, { findOne: orig.find, create: orig.create });
    Quiz.findOne = orig.quiz;
    console.error = oldLog;
  }
});

test("attempt access requires a valid cookie, write requires trusted Origin", async () => {
  await withServer(async (base) => {
    const current = await fetch(base + "/api/v1/student/attempts/current");
    assert.equal(current.status, 401);
    const start = await fetch(base + "/api/v1/student/attempts/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });
    assert.equal(start.status, 403);
  });
});

test("questions exclude answer keys and obsolete timers", () => {
  const quiz = {
    randomizeQuestions: true, randomizeOptions: true,
    questions: [{
      _id: new mongoose.Types.ObjectId(), type: "mcq", prompt: "Pick one",
      options: ["A", "B"], correctAnswer: "B", points: 1,
      testCases: [{ expected: "hidden" }],
    }],
  };
  const first = studentQuestions(quiz, attemptId);
  assert.deepEqual(first, studentQuestions(quiz, attemptId));
  for (const key of ["correctAnswer", "testCases", "timeSeconds"]) {
    assert.ok(!(key in first[0]));
  }
});

test("expired attempt doesn't reveal questions", async () => {
  const original = Attempt.findById;
  Attempt.findById = () => ({
    lean: async () => ({
      _id: attemptId, quiz: new mongoose.Types.ObjectId(quizId),
      email: "ahmed@example.test", studentName: "Ahmed Ali", phone: "03001234567",
      status: "started", startedAt: new Date(Date.now() - 3600_000),
      expiresAt: new Date(Date.now() - 1000),
    }),
  });
  try {
    await withServer(async (base) => {
      const response = await fetch(base + "/api/v1/student/attempts/current", {
        headers: { Cookie: "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret) },
      });
      assert.equal(response.status, 200);
      const data = (await response.json()).data;
      assert.equal(data.attempt.status, "expired");
      assert.deepEqual(data.questions, []);
      assert.ok(Number.isFinite(Date.parse(data.serverNow)));
    });
  } finally { Attempt.findById = original; }
});
