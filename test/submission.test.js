import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Attempt } from "../src/models/attempt.model.js";
import { Quiz } from "../src/models/quiz.model.js";
import { generateAttemptJwt } from "../src/utils/generateJwt.js";
import { draftSchema, submissionSchema } from "../src/validations/submission.validation.js";

const origin = "http://localhost:5173";
const secret = "unique-testing-secret-over-32-characters-and-more";
const quizId = new mongoose.Types.ObjectId();
const questionId = new mongoose.Types.ObjectId();
const attemptId = new mongoose.Types.ObjectId();
const slotId = new mongoose.Types.ObjectId();

const answers = [{
  questionId: String(questionId), answer: "B", timeSpent: 10, timedOut: false,
}];

async function withServer(callback) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret,
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function cookie() {
  return "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret);
}

async function request(base, path, method, body) {
  return fetch(base + path, {
    method,
    headers: {
      Origin: origin, Cookie: cookie(), "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function query(value) {
  return {
    select() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

// Simulate MongoDB's atomic version/expiry/status conditional write.
// This is a unit-level API test, NOT a substitute for a real MongoDB test.
async function withFakeDatabase(callback, expired = false) {
  const original = {
    attemptById: Attempt.findById,
    attemptUpdate: Attempt.findOneAndUpdate,
    quizById: Quiz.findById,
  };

  let writes = 0;
  let state = {
    _id: attemptId, quiz: quizId, slot: slotId,
    studentName: "Ahmed Ali", rollNo: "00123",
    status: "started", answers: [], draftVersion: 0,
    startedAt: new Date(Date.now() - 20_000),
    expiresAt: new Date(Date.now() + (expired ? -1000 : 60_000)),
    lastSavedAt: null,
  };
  Attempt.findById = () => query(state);
  Quiz.findById = () => query({
    _id: quizId, questionCount: 2, title: "Quiz",
    randomizeQuestions: false, randomizeOptions: false,
    questions: [{
      _id: questionId, type: "mcq", prompt: "Pick an answer",
      options: ["A", "B"], correctAnswer: "B", points: 1, timeSeconds: 30,
    }],
  });
  Attempt.findOneAndUpdate = (filter, update) => {
    const validStatus = state?.status === filter.status;
    const validTime = !filter.expiresAt ||
      (filter.expiresAt.$gt && state.expiresAt > filter.expiresAt.$gt) ||
      (filter.expiresAt.$lte && state.expiresAt <= filter.expiresAt.$lte);
    const version = filter.draftVersion;
    const validVersion = !version ||
      (typeof version === "number" && state.draftVersion === version) ||
      (Array.isArray(version.$in) && version.$in.includes(state.draftVersion)) ||
      (Number.isInteger(version.$lt) && state.draftVersion < version.$lt) ||
      (Number.isInteger(version.$lte) && state.draftVersion <= version.$lte);

    if (validStatus && validTime && validVersion) {
      writes++;
      state = { ...state, ...update.$set };
      return query(state);
    }
    return query(null);
  };

  try {
    await callback({
      read: () => state,
      countWrites: () => writes,
      replace: (patch) => { state = { ...state, ...patch }; },
    });
  } finally {
    Attempt.findById = original.attemptById;
    Attempt.findOneAndUpdate = original.attemptUpdate;
    Quiz.findById = original.quizById;
  }
}

test("draft and submission validation accept numeric rolls' unrelated answer IDs as hex", () => {
  const { error } = draftSchema.validate({ version: 1, answers });
  assert.equal(error, undefined);
});

test("do not accept client scores, test results or duplicate answer IDs", () => {
  assert.ok(draftSchema.validate({
    version: 1, answers: [{ ...answers[0], testResults: [{ passed: true }] }],
  }).error);
  assert.ok(submissionSchema.validate({
    version: 1, answers: [answers[0], answers[0]],
  }).error);
  assert.ok(submissionSchema.validate({
    version: 1, answers, score: 100,
  }).error);
});

test("reject invalid versions and oversized code", () => {
  assert.ok(draftSchema.validate({ version: 0, answers }).error);
  assert.ok(draftSchema.validate({ version: 1.5, answers }).error);
  assert.ok(draftSchema.validate({
    version: 1, answers: [{ ...answers[0], answer: "x".repeat(12001) }],
  }).error);
});

test("draft and submit routes require signed attempt cookie", async () => {
  await withServer(async (base) => {
    for (const [method, path, body] of [
      ["PUT", "/api/v1/student/attempts/draft", { version: 1, answers }],
      ["POST", "/api/v1/student/attempts/submit", { version: 1, answers }],
    ]) {
      const response = await fetch(base + path, {
        method,
        headers: { Origin: origin, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 401);
    }
  });
});

test("draft saves versioned answers, identical retry is safe, stale writes rejected", async () => {
  await withFakeDatabase(async (db) => {
    await withServer(async (base) => {
      const first = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 1, answers });
      assert.equal(first.status, 200);
      assert.equal((await first.json()).data.version, 1);
      assert.equal(db.countWrites(), 1);

      const retry = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 1, answers });
      assert.equal(retry.status, 200);
      assert.equal(db.countWrites(), 1);

      const stale = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 1, answers: [{ ...answers[0], answer: "A" }] });
      assert.equal(stale.status, 409);
      assert.equal(db.read().answers[0].answer, "B");
      assert.equal(db.countWrites(), 1);

      const newer = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 2, answers: [{ ...answers[0], answer: "A" }] });
      assert.equal(newer.status, 200);
      assert.equal(db.read().answers[0].answer, "A");

      const current = await fetch(base + "/api/v1/student/attempts/current", {
        headers: { Cookie: cookie() },
      });
      assert.equal(current.status, 200);
      const data = (await current.json()).data;
      assert.equal(data.draft.version, 2);
      assert.equal(data.draft.answers[0].answer, "A");
      assert.ok(!("correctAnswer" in data.questions[0]));
    });
  });
});

test("draft ignores unknown question IDs and rejects saves after deadline", async () => {
  await withFakeDatabase(async (db) => {
    await withServer(async (base) => {
      const unknown = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 1, answers: [{ ...answers[0], questionId: String(new mongoose.Types.ObjectId()) }] });
      assert.equal(unknown.status, 400);
      assert.equal(db.countWrites(), 0);
      db.replace({ expiresAt: new Date(Date.now() - 1_000) });
      const expired = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 1, answers });
      assert.equal(expired.status, 409);
      assert.equal(db.countWrites(), 0);
    });
  });
});

test("submit wins once, final answers are immutable, retries return same receipt", async () => {
  await withFakeDatabase(async (db) => {
    await withServer(async (base) => {
      const first = await request(base, "/api/v1/student/attempts/submit", "POST",
        { version: 1, answers, reason: "student" });
      assert.equal(first.status, 200);
      const receipt = (await first.json()).data;
      assert.equal(receipt.status, "submitted");
      assert.equal(receipt.answeredCount, 1);
      assert.equal(receipt.unansweredCount, 0);
      assert.equal(db.read().score, 1);
      assert.equal(db.read().gradingStatus, "graded");
      assert.equal(db.countWrites(), 1);

      const retry = await request(base, "/api/v1/student/attempts/submit", "POST",
        { version: 1, answers: [], reason: "student" });
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).data.attemptId, receipt.attemptId);
      assert.equal(db.countWrites(), 1);
      assert.equal(db.read().answers[0].answer, "B");

      const after = await request(base, "/api/v1/student/attempts/draft", "PUT",
        { version: 2, answers });
      assert.equal(after.status, 409);
    });
  });
});

test("expired submission finalizes ONLY previously saved draft, not late answers", async () => {
  await withFakeDatabase(async (db) => {
    db.replace({ answers: [{ ...answers[0], answer: "B" }], draftVersion: 2 });
    await withServer(async (base) => {
      const late = await request(base, "/api/v1/student/attempts/submit", "POST",
        { version: 3, answers: [{ ...answers[0], answer: "A" }], reason: "student" });
      assert.equal(late.status, 200);
      assert.equal(db.read().status, "submitted");
      assert.equal(db.read().submitReason, "time_ended");
      assert.equal(db.read().answers[0].answer, "B");
      assert.equal(db.read().score, 1);
      assert.equal(db.read().gradingStatus, "graded");
      assert.equal(db.countWrites(), 1);
    });
  }, true);
});
