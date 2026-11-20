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
const key = randomUUID();
const candidate = {
  quizId, fullName: "Ahmed Ali", email: "Ahmed@Example.com",
  phone: "+92 300 1234567", startKey: key,
};

function query(value) {
  return {
    select() { return this; },
    sort() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

async function withServer(fn) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret, nodeEnv: "test",
    cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await fn("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const post = (base, body) => fetch(base + "/api/v1/student/attempts/start", {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("validates full name, normalized email, international phone and UUIDv4", () => {
  const { error, value } = startAttemptSchema.validate(candidate);
  assert.equal(error, undefined);
  assert.equal(value.email, "ahmed@example.com");
  assert.equal(value.phone, "+923001234567");
  for (const patch of [
    { email: "invalid" }, { fullName: "x" },
    { phone: "12345" }, { startKey: "not-a-uuid" },
    { rollNo: "00123" },
  ]) {
    assert.ok(startAttemptSchema.validate({ ...candidate, ...patch }).error);
  }
});

test("attempt has a partial unique quiz/email index and no slot model dependency", () => {
  assert.ok(Attempt.schema.indexes().some(([index, config]) =>
    index.quiz === 1 && index.email === 1 && config.unique &&
    config.partialFilterExpression?.email?.$type === "string"));
  assert.equal(Attempt.schema.path("slot"), undefined);
  assert.equal(Attempt.schema.path("seatNumber"), undefined);
  assert.equal(Attempt.schema.path("rollNo"), undefined);
});

test("start endpoint rejects invalid candidate before database queries", async () => {
  await withServer(async (base) => {
    const response = await post(base, { ...candidate, email: "bad" });
    assert.equal(response.status, 400);
  });
});

test("student GET /current requires the signed attempt cookie", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/student/attempts/current");
    assert.equal(response.status, 401);
  });
});

test("untrusted/no-origin writes are blocked", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/student/attempts/start", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });
    assert.equal(response.status, 403);
  });
});

test("safe question delivery never exposes correct answers, testCases or question timers", () => {
  const qId = new mongoose.Types.ObjectId();
  const quiz = {
    randomizeQuestions: true, randomizeOptions: true,
    questions: [{
      _id: qId, type: "mcq", prompt: "Choose", options: ["A", "B"],
      correctAnswer: "B", points: 1, timeSeconds: 15,
      testCases: [{ expected: "SECRET" }],
    }],
  };
  const questions = studentQuestions(quiz, attemptId);
  assert.deepEqual(questions, studentQuestions(quiz, attemptId));
  assert.equal(questions[0].correctAnswer, undefined);
  assert.equal(questions[0].testCases, undefined);
  assert.equal(questions[0].timeSeconds, undefined);
});

test("published quiz starts without a slot and expires after its own duration", async () => {
  const originals = {
    findOne: Attempt.findOne, create: Attempt.create, quiz: Quiz.findOne,
  };
  const attempts = new Map();
  Attempt.findOne = ({ email }) => query(attempts.get(email) || null);
  Quiz.findOne = () => query({ durationMinutes: 60, maxViolations: 3 });
  Attempt.create = async (record) => {
    if (attempts.has(record.email)) {
      const error = new Error("duplicate");
      error.code = 11000;
      error.keyPattern = { quiz: 1, email: 1 };
      throw error;
    }
    const a = { ...record, _id: new mongoose.Types.ObjectId(), status: "started",
      violationCount: 0 };
    attempts.set(record.email, a);
    return a;
  };
  try {
    await withServer(async (base) => {
      const first = await post(base, candidate);
      assert.equal(first.status, 200);
      const created = (await first.json()).data;
      assert.equal(created.email, "ahmed@example.com");
      assert.equal(created.fullName, "Ahmed Ali");
      assert.equal(created.phone, "+923001234567");
      assert.equal(created.maxViolations, 3);
      assert.equal(new Date(created.expiresAt) - new Date(created.startedAt), 3_600_000);
      assert.ok(first.headers.get("set-cookie"));

      // Same retry key is idempotent.
      const retry = await post(base, { ...candidate, email: "AHMED@example.com" });
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).data.id, created.id);

      // A second key with the same email is refused for this quiz.
      const duplicate = await post(base, { ...candidate, startKey: randomUUID() });
      assert.equal(duplicate.status, 409);
      assert.equal(attempts.size, 1);
    });
  } finally {
    Attempt.findOne = originals.findOne;
    Attempt.create = originals.create;
    Quiz.findOne = originals.quiz;
  }
});

test("expired current attempt returns no private questions", async () => {
  const original = Attempt.findById;
  Attempt.findById = () => query({
    _id: attemptId, quiz: new mongoose.Types.ObjectId(quizId),
    fullName: "Ahmed Ali", email: "ahmed@example.com", phone: "+923001234567",
    violationCount: 1, maxViolations: 3, status: "started",
    startedAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() - 10_000),
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
