import "dotenv/config";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { Quiz } from "../models/quiz.model.js";
import { Attempt } from "../models/attempt.model.js";
import { generateAttemptJwt } from "../utils/generateJwt.js";
import { finalizeExpiredAttempt } from "../utils/finalizeExpiredAttempt.js";

// This separate test deliberately makes only a few competing requests per
// attempt. It tests atomicity, not the 250-user throughput of testExamJourney.
const uri = process.env.TEST_MONGODB_URI;
const origin = "http://localhost:5173";
const secret = randomBytes(32).toString("hex");
const config = {
  allowedOrigins: [origin], jwtSecret: secret, nodeEnv: "test",
  cookieSameSite: "lax", isDbReady: () => mongoose.connection.readyState === 1,
};
const counts = { outOfOrderDrafts: 0, duplicateSubmits: 0,
  draftVsSubmit: 0, expiredFinalization: 0, restartRecovery: 0 };
let quiz;
let server;
let base;
let nextStudent = 1;
let questionId;
let created = 0;

function answer(value) {
  return [{ questionId, answer: value }];
}

async function listen() {
  server = createApp(config).listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    if (server.listening) return resolve();
    server.once("listening", resolve);
    server.once("error", reject);
  });
  base = "http://127.0.0.1:" + server.address().port;
}

async function closeServer() {
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise((resolve, reject) =>
    closing.close((error) => error ? reject(error) : resolve()));
}

async function createAttempt({ version = 0, savedAnswer = "", expired = false } = {}) {
  const number = nextStudent++;
  const attempt = await Attempt.create({
    quiz: quiz._id,
    studentName: "Race Test Student " + number,
    email: "race-" + String(quiz._id) + "-" + number + "@example.test",
    phone: "03001234567",
    startKeyHash: createHash("sha256").update(randomUUID()).digest("hex"),
    startedAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() + (expired ? -10_000 : 10 * 60_000)),
    draftVersion: version,
    answers: savedAnswer ? answer(savedAnswer) : [],
  });
  created += 1;
  return attempt;
}

async function request(attempt, method, path, body) {
  const response = await fetch(base + "/api/v1/student/attempts/" + path, {
    method,
    headers: {
      Origin: origin,
      Cookie: "quiz_hub_attempt=" + generateAttemptJwt(attempt, secret),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, payload: await response.json() };
}

function checkStatus(result, expected, label) {
  assert.equal(result.status, expected, label + ": unexpected HTTP status");
}

async function testOutOfOrderDrafts() {
  const attempt = await createAttempt();
  // HTTP request arrival/completion order is deliberately not guaranteed.
  const [newer, older] = await Promise.all([
    request(attempt, "PUT", "draft", { version: 2, answers: answer("B") }),
    request(attempt, "PUT", "draft", { version: 1, answers: answer("A") }),
  ]);
  checkStatus(newer, 200, "higher-version draft");
  assert.ok([200, 409].includes(older.status));
  const saved = await Attempt.findById(attempt._id).lean();
  assert.equal(saved.draftVersion, 2);
  assert.equal(saved.answers[0].answer, "B");
  const retry = await request(attempt, "PUT", "draft", {
    version: 2, answers: answer("B"),
  });
  checkStatus(retry, 200, "idempotent draft retry");
  const stale = await request(attempt, "PUT", "draft", {
    version: 1, answers: answer("A"),
  });
  checkStatus(stale, 409, "stale draft");
  const current = await request(attempt, "GET", "current");
  checkStatus(current, 200, "resumed current draft");
  assert.equal(current.payload.data.draft.version, 2);
  assert.equal(current.payload.data.draft.answers[0].answer, "B");
  counts.outOfOrderDrafts += 1;
}

async function testDuplicateSubmits() {
  const attempt = await createAttempt();
  const responses = await Promise.all([
    request(attempt, "POST", "submit", {
      version: 1, answers: answer("A"), reason: "student",
    }),
    request(attempt, "POST", "submit", {
      version: 1, answers: answer("B"), reason: "student",
    }),
  ]);
  for (const response of responses) checkStatus(response, 200, "simultaneous submit");
  const saved = await Attempt.findById(attempt._id).lean();
  assert.equal(saved.status, "submitted");
  assert.equal(saved.draftVersion, 1);
  assert.ok(["A", "B"].includes(saved.answers[0].answer));
  assert.equal(saved.score, saved.answers[0].answer === "B" ? 1 : 0);
  assert.equal(saved.gradingStatus, "graded");
  const retry = await request(attempt, "POST", "submit", {
    version: 2, answers: answer(saved.answers[0].answer === "B" ? "A" : "B"),
    reason: "student",
  });
  checkStatus(retry, 200, "final submission retry");
  assert.equal(retry.payload.data.attemptId, String(attempt._id));
  const after = await Attempt.findById(attempt._id).lean();
  assert.deepEqual(after.answers, saved.answers, "duplicate submit rewrote final answers");
  assert.equal(after.score, saved.score);
  const lateDraft = await request(attempt, "PUT", "draft", {
    version: 3, answers: answer("B"),
  });
  checkStatus(lateDraft, 409, "draft after submitted");
  counts.duplicateSubmits += 1;
}

async function testDraftVsSubmit() {
  const attempt = await createAttempt({ version: 1, savedAnswer: "A" });
  const [draft, submit] = await Promise.all([
    request(attempt, "PUT", "draft", { version: 3, answers: answer("B") }),
    request(attempt, "POST", "submit", {
      version: 2, answers: answer("A"), reason: "student",
    }),
  ]);
  let saved = await Attempt.findById(attempt._id).lean();
  if (draft.status === 200) {
    checkStatus(submit, 409, "stale submit lost race with newer draft");
    assert.equal(saved.status, "started");
    assert.equal(saved.draftVersion, 3);
    assert.equal(saved.answers[0].answer, "B");
    const later = await request(attempt, "POST", "submit", {
      version: 4, answers: answer("B"), reason: "student",
    });
    checkStatus(later, 200, "submit after refreshing newer draft");
    saved = await Attempt.findById(attempt._id).lean();
  } else {
    checkStatus(draft, 409, "draft lost race with final submission");
    checkStatus(submit, 200, "submit won race");
  }
  assert.equal(saved.status, "submitted");
  assert.equal(saved.score, saved.answers[0].answer === "B" ? 1 : 0);
  counts.draftVsSubmit += 1;
}

async function testExpiredFinalization() {
  const attempt = await createAttempt({
    version: 1, savedAnswer: "B", expired: true,
  });
  const [late, finalizer] = await Promise.all([
    request(attempt, "POST", "submit", {
      version: 2, answers: answer("A"), reason: "student",
    }),
    finalizeExpiredAttempt(attempt._id),
  ]);
  checkStatus(late, 200, "late submission");
  assert.equal(finalizer.status, "submitted");
  const saved = await Attempt.findById(attempt._id).lean();
  assert.equal(saved.status, "submitted");
  assert.equal(saved.submitReason, "time_ended");
  assert.equal(saved.draftVersion, 1);
  assert.equal(saved.answers[0].answer, "B", "late answers replaced saved draft");
  assert.equal(saved.score, 1);
  counts.expiredFinalization += 1;
}

async function testRestartRecovery() {
  const attempt = await createAttempt();
  const save = await request(attempt, "PUT", "draft", {
    version: 1, answers: answer("B"),
  });
  checkStatus(save, 200, "save before HTTP restart");
  await closeServer();
  await listen();
  const recovered = await request(attempt, "GET", "current");
  checkStatus(recovered, 200, "resume after HTTP restart");
  assert.equal(recovered.payload.data.draft.version, 1);
  assert.equal(recovered.payload.data.draft.answers[0].answer, "B");
  counts.restartRecovery += 1;
}

async function run() {
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error("Set TEST_MONGODB_URI selecting only quiz_hub_test");
  }
  await connectDB(uri);
  if (mongoose.connection.db.databaseName !== "quiz_hub_test") {
    throw new Error("REFUSED: test database must be named quiz_hub_test");
  }
  console.info("Connected to isolated quiz_hub_test DB (credentials hidden)");
  await Promise.all([Quiz.init(), Attempt.init()]);
  const id = randomUUID().slice(0, 8);
  quiz = await Quiz.create({
    title: "Race Integration " + id,
    durationMinutes: 15,
    maxViolations: 3,
    questionCount: 1,
    isPublished: true,
    questions: [{
      type: "mcq", prompt: "Pick the correct option",
      options: ["A", "B"], correctAnswer: "B", points: 1,
    }],
  });
  questionId = String(quiz.questions[0]._id);
  await listen();
  const iterations = 5;
  for (let i = 0; i < iterations; i += 1) {
    await testOutOfOrderDrafts();
    await testDuplicateSubmits();
    await testDraftVsSubmit();
    await testExpiredFinalization();
  }
  await testRestartRecovery();
  const saved = await Attempt.find({ quiz: quiz._id }).lean();
  assert.equal(saved.length, created, "Missing or duplicate attempts");
  assert.equal(saved.filter((a) => a.status === "submitted").length,
    iterations * 3, "Incorrect final-submission count");
  assert.equal(saved.filter((a) => a.status === "started").length,
    iterations + 1, "Unexpected active-attempt count");
  console.info(JSON.stringify({
    test: "Real MongoDB autosave/submission races",
    iterations,
    assertionsPassed: true,
    recordsVerified: saved.length,
    scenarios: counts,
  }, null, 2));
  console.info("PASS: real-DB concurrency and restart invariants");
}

try {
  await run();
} catch (error) {
  // Redact any URI from a network or driver error message.
  const message = String(error?.message || "Unknown failure")
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[REDACTED]").slice(0, 220);
  console.error("RACE TEST FAILED:", message);
  process.exitCode = 1;
} finally {
  try { await closeServer(); } catch { process.exitCode = 1; }
  try {
    if (mongoose.connection.db?.databaseName === "quiz_hub_test") {
      if (quiz?._id) {
        await Attempt.deleteMany({ quiz: quiz._id });
        await Quiz.deleteOne({ _id: quiz._id });
      }
    }
    await disconnectDB();
    console.info("Temporary race-test fixtures cleaned up");
  } catch {
    console.error("Fixture cleanup failed; inspect only quiz_hub_test");
    process.exitCode = 1;
  }
}
