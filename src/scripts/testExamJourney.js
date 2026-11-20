import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { Quiz } from "../models/quiz.model.js";
import { Slot } from "../models/slot.model.js";
import { Attempt } from "../models/attempt.model.js";
import { Admin } from "../models/admin.model.js";
import { generateAdminJwt, generateAttemptJwt } from "../utils/generateJwt.js";

const usersArg = process.argv.find((arg) => arg.startsWith("--users="));
const userCount = Number(usersArg?.split("=")[1] || 5);
const uri = process.env.TEST_MONGODB_URI;
const origin = "http://localhost:5173";
const secret = randomBytes(32).toString("hex");

if (!Number.isInteger(userCount) || userCount < 2 || userCount > 250) {
  console.error("Use --users=5 through --users=250");
  process.exit(1);
}
if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
  console.error("Set TEST_MONGODB_URI for a separate quiz_hub_test database.");
  process.exit(1);
}

// This script MUST NOT use the application's production MONGODB_URI.
const id = randomUUID().slice(0, 8);
const config = {
  allowedOrigins: [origin],
  jwtSecret: secret,
  nodeEnv: "test",
  cookieSameSite: "lax",
  isDbReady: () => mongoose.connection.readyState === 1,
};
let quiz;
let slot;
let admin;
let server;
let base;

function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.ceil(sorted.length * percent / 100) - 1]);
}

async function http(path, { method = "GET", body, cookie } = {}) {
  const started = performance.now();
  const headers = { Origin: origin };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(base + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90_000),
  });
  const raw = await res.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return {
    status: res.status,
    data,
    headers: res.headers,
    ms: Math.round(performance.now() - started),
  };
}

function expectOk(response, action) {
  if (response.status !== 200) {
    throw new Error(action + " returned HTTP " + response.status + ": " +
      String(response.data?.message || "Unexpected response").slice(0, 150));
  }
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

async function runStudent(i, questionId) {
  const rollNo = String(i + 1).padStart(6, "0");
  const startKey = randomUUID();
  const startBody = {
    quizId: String(quiz._id), studentName: "Load Student " + (i + 1),
    rollNo, startKey,
  };
  const start = await http("/api/v1/student/attempts/start", {
    method: "POST", body: startBody,
  });
  expectOk(start, "start " + rollNo);
  const cookie = start.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("quiz_hub_attempt="));

  const current = await http("/api/v1/student/attempts/current", { cookie });
  expectOk(current, "resume " + rollNo);
  assert.equal(current.data.data.questions.length, 1);
  assert.ok(!("correctAnswer" in current.data.data.questions[0]));

  const answers = [{ questionId, answer: "B", timeSpent: 5, timedOut: false }];
  const draft = await http("/api/v1/student/attempts/draft", {
    method: "PUT", cookie, body: { version: 1, answers },
  });
  expectOk(draft, "autosave " + rollNo);

  const submit = await http("/api/v1/student/attempts/submit", {
    method: "POST", cookie, body: { version: 2, answers, reason: "student" },
  });
  expectOk(submit, "submit " + rollNo);
  assert.equal(submit.data.data.status, "submitted");

  return {
    rollNo, startKey, startBody, cookie, attemptId: start.data.data.id,
    timings: { start: start.ms, current: current.ms, draft: draft.ms, submit: submit.ms },
  };
}

async function run() {
  await connectDB(uri);

  // Do not create/drop/modify any database except the explicit integration DB.
  if (mongoose.connection.db.databaseName !== "quiz_hub_test") {
    throw new Error("REFUSED: TEST_MONGODB_URI must select database quiz_hub_test");
  }
  console.info("Connected to dedicated quiz_hub_test DB (no credentials printed)");
  await Promise.all([Quiz.init(), Slot.init(), Attempt.init(), Admin.init()]);

  quiz = await Quiz.create({
    title: "Integration Test " + id,
    description: "Temporary exam fixture",
    durationMinutes: 30,
    questionTimeSeconds: 45,
    maxViolations: 3,
    isPublished: true,
    questionCount: 1,
    questions: [{
      type: "mcq", prompt: "Choose the correct answer",
      options: ["A", "B"], correctAnswer: "B", points: 1, timeSeconds: 45,
    }],
  });
  slot = await Slot.create({
    quiz: quiz._id, name: "Integration Slot " + id,
    startsAt: new Date(Date.now() - 60_000),
    endsAt: new Date(Date.now() + 20 * 60_000),
    capacity: userCount,
  });
  admin = await Admin.create({
    email: "integration-" + id + "@example.invalid",
    passwordHash: "not-used-by-this-test",
  });
  await listen();

  const questionId = String(quiz.questions[0]._id);
  const startTime = performance.now();
  const results = await Promise.allSettled(
    Array.from({ length: userCount }, (_, i) => runStudent(i, questionId))
  );
  const good = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const failed = results.filter((r) => r.status === "rejected")
    .map((r) => String(r.reason?.message || r.reason));
  const attemptCount = await Attempt.countDocuments({ quiz: quiz._id });
  const submittedCount = await Attempt.countDocuments({ quiz: quiz._id, status: "submitted" });
  const admittedCount = await Attempt.countDocuments({ slot: slot._id });
  const reservedSeats = await Attempt.distinct("seatNumber", { slot: slot._id });

  console.info(JSON.stringify({
    requestedStudents: userCount,
    successfulJourneys: good.length,
    failures: failed.length,
    firstFailures: failed.slice(0, 8),
    databaseAttempts: attemptCount,
    databaseSubmissions: submittedCount,
    slotAdmissions: admittedCount,
    totalElapsedMs: Math.round(performance.now() - startTime),
    p95RequestLatencyMs: Object.fromEntries(
      ["start", "current", "draft", "submit"].map((key) =>
        [key, percentile(good.map((r) => r.timings[key]), 95)]
      )
    ),
  }, null, 2));

  assert.equal(failed.length, 0, "Not all simulated students completed successfully");
  assert.equal(attemptCount, userCount, "Missing/duplicate attempts");
  assert.equal(submittedCount, userCount, "Missing submissions");
  assert.equal(admittedCount, userCount, "Incorrect occupied seat count");
  assert.equal(reservedSeats.length, userCount, "Two students were assigned the same seat");
  assert.ok(reservedSeats.every((seat) => Number.isInteger(seat) &&
    seat >= 1 && seat <= userCount), "Seat number outside slot capacity");

  const first = good[0];
  const sameKey = await http("/api/v1/student/attempts/start", {
    method: "POST", body: first.startBody,
  });
  expectOk(sameKey, "idempotent start retry");
  assert.equal(sameKey.data.data.id, first.attemptId);

  const differentKey = await http("/api/v1/student/attempts/start", {
    method: "POST", body: { ...first.startBody, startKey: randomUUID() },
  });
  assert.equal(differentKey.status, 409, "Duplicated roll number must be rejected");

  // The slot has exactly userCount seats: a new roll must receive 409.
  const beyondCapacity = await http("/api/v1/student/attempts/start", {
    method: "POST",
    body: { ...first.startBody, rollNo: "999998", startKey: randomUUID() },
  });
  assert.equal(beyondCapacity.status, 409, "Full slot must reject new students");

  const repeatedSubmit = await http("/api/v1/student/attempts/submit", {
    method: "POST", cookie: first.cookie,
    body: { version: 3, answers: [], reason: "student" },
  });
  expectOk(repeatedSubmit, "idempotent submit retry");
  assert.equal(repeatedSubmit.data.data.attemptId, first.attemptId);
  const saved = await Attempt.findById(first.attemptId);
  assert.equal(saved.answers[0].answer, "B", "Retry changed finalized answers");
  assert.equal(saved.score, 1, "Server-side grading returned wrong score");

  const adminCookie = "quiz_hub_admin=" + generateAdminJwt(admin, secret);
  const stats = await http("/api/v1/admin/results/stats?quizId=" + quiz._id, { cookie: adminCookie });
  expectOk(stats, "admin stats");
  assert.equal(stats.data.data.totalAttempts, userCount);
  assert.equal(stats.data.data.submitted, userCount);

  const page = await http("/api/v1/admin/results?quizId=" + quiz._id + "&limit=25", {
    cookie: adminCookie,
  });
  expectOk(page, "admin pagination");
  assert.equal(page.data.data.items.length, Math.min(25, userCount));
  assert.equal(page.data.data.hasMore, userCount > 25);

  const csv = await http("/api/v1/admin/results/export?quizId=" + quiz._id, {
    cookie: adminCookie,
  });
  assert.equal(csv.status, 200);
  assert.equal(csv.data.trimEnd().split("\r\n").length, userCount + 1);
  assert.ok(!csv.data.includes("startKeyHash"));

  // A late submit must use only previously persisted answers.
  const expired = await Attempt.create({
    quiz: quiz._id, slot: slot._id, studentName: "Expired Test",
    rollNo: "999999999999999999999999", startKeyHash: randomBytes(32).toString("hex"),
    startedAt: new Date(Date.now() - 3600_000),
    expiresAt: new Date(Date.now() - 120_000),
    status: "started", draftVersion: 1,
    answers: [{ questionId, answer: "B", timeSpent: 2, timedOut: false }],
  });
  const expiredCookie = "quiz_hub_attempt=" + generateAttemptJwt(expired, secret);
  const late = await http("/api/v1/student/attempts/submit", {
    method: "POST", cookie: expiredCookie,
    body: { version: 2, reason: "student", answers: [
      { questionId, answer: "A", timeSpent: 3, timedOut: false },
    ] },
  });
  expectOk(late, "expired attempt");
  const persisted = await Attempt.findById(expired._id);
  assert.equal(persisted.status, "submitted");
  assert.equal(persisted.submitReason, "time_ended");
  assert.equal(persisted.answers[0].answer, "B");
  assert.equal(persisted.score, 1);

  // Restart the HTTP server and verify the attempt is still recoverable.
  await closeServer();
  await listen();
  const restored = await http("/api/v1/student/attempts/current", {
    cookie: first.cookie,
  });
  expectOk(restored, "recover after process restart");
  assert.equal(restored.data.data.attempt.status, "submitted");

  console.info("PASS: real DB journeys, retries, CSV, expiry, grading and restart recovery");
}

try {
  await run();
} catch (error) {
  // Never log MongoDB driver objects or connection URIs: they can contain credentials.
  console.error("TEST FAILED:", error instanceof Error ? error.message.split("mongodb")[0].slice(0, 250) : "Unknown failure");
  process.exitCode = 1;
} finally {
  try { await closeServer(); } catch { process.exitCode = 1; }
  try {
    if (mongoose.connection.db?.databaseName === "quiz_hub_test") {
      if (quiz?._id) {
        await Attempt.deleteMany({ quiz: quiz._id });
        await Slot.deleteMany({ quiz: quiz._id });
        await Quiz.deleteOne({ _id: quiz._id });
      }
      if (admin?._id) await Admin.deleteOne({ _id: admin._id });
    }
    await disconnectDB();
    console.info("Temporary integration fixtures cleaned up.");
  } catch {
    console.error("Cleanup failed; check temporary integration fixtures in quiz_hub_test");
    process.exitCode = 1;
  }
}
