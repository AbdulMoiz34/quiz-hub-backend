import "dotenv/config";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import mongoose from "mongoose";
import { createApp } from "../app.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { Quiz } from "../models/quiz.model.js";
import { Attempt } from "../models/attempt.model.js";
import { Admin } from "../models/admin.model.js";
import { generateAdminJwt } from "../utils/generateJwt.js";

// A small real-MongoDB HTTP lifecycle regression, not a throughput benchmark.
// Never read or write the application's MONGODB_URI here.
const uri = process.env.TEST_MONGODB_URI;
const origin = "http://localhost:5173";
const secret = randomBytes(32).toString("hex");
const id = randomUUID().slice(0, 8);
let quiz;
let admin;
let server;

function expectStatus(result, status, description) {
  assert.equal(result.status, status, description + ": unexpected HTTP status");
  return result.data?.data;
}

async function run() {
  if (!uri || !/^mongodb(?:\+srv)?:\/\//.test(uri)) {
    throw new Error("Set TEST_MONGODB_URI for the isolated quiz_hub_test database");
  }
  await connectDB(uri);
  if (mongoose.connection.db.databaseName !== "quiz_hub_test") {
    throw new Error("REFUSED: database name must be exactly quiz_hub_test");
  }
  await Promise.all([Quiz.init(), Attempt.init(), Admin.init()]);

  quiz = await Quiz.create({
    title: "Lifecycle Integration " + id,
    durationMinutes: 60,
    maxViolations: 3,
    isPublished: true,
    questionCount: 1,
    questions: [{
      type: "mcq", prompt: "Select B",
      options: ["A", "B"], correctAnswer: "B", points: 1,
    }],
  });
  admin = await Admin.create({
    email: "lifecycle-" + id + "@example.invalid",
    passwordHash: "unused-by-this-test",
  });
  server = createApp({
    allowedOrigins: [origin], jwtSecret: secret,
    nodeEnv: "test", cookieSameSite: "lax",
    isDbReady: () => mongoose.connection.readyState === 1,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");

  const base = "http://127.0.0.1:" + server.address().port;
  const quizId = String(quiz._id);
  const questionId = String(quiz.questions[0]._id);
  const adminCookie = "quiz_hub_admin=" + generateAdminJwt(admin, secret);
  const correctAnswers = [{ questionId, answer: "B" }];
  const wrongAnswers = [{ questionId, answer: "A" }];

  async function http(path, { method = "GET", body, cookie } = {}) {
    const response = await fetch(base + "/api/v1/" + path, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  function details(label, startKey = randomUUID()) {
    return {
      quizId, studentName: "Lifecycle Student",
      email: label + "-" + id + "@example.test",
      phone: "+923001234567", startKey,
    };
  }
  async function start(body) {
    const response = await http("student/attempts/start", { method: "POST", body });
    const data = expectStatus(response, 200, "start candidate");
    assert.ok(response.cookie?.startsWith("quiz_hub_attempt="));
    return { data, cookie: response.cookie };
  }
  async function remove(attemptId) {
    return http("admin/attempts/" + attemptId, { method: "DELETE", cookie: adminCookie });
  }

  // Registration, quiz-wide deadline, server autosave, finalization and reset.
  const firstBody = details("normal");
  const first = await start(firstBody);
  assert.equal(Date.parse(first.data.expiresAt) - Date.parse(first.data.startedAt), 60 * 60_000);
  const current = expectStatus(await http("student/attempts/current", {
    cookie: first.cookie,
  }), 200, "resume started exam");
  assert.equal(current.attempt.id, first.data.id);
  assert.equal(current.quiz.durationMinutes, 60);
  assert.equal(current.questions.length, 1);
  assert.ok(!("correctAnswer" in current.questions[0]));
  assert.ok(!("timeSeconds" in current.questions[0]));
  assert.equal(current.draft.version, 0);

  expectStatus(await http("student/attempts/draft", {
    method: "PUT", cookie: first.cookie,
    body: { version: 1, answers: correctAnswers },
  }), 200, "autosave correct answer");
  const recovered = expectStatus(await http("student/attempts/current", {
    cookie: first.cookie,
  }), 200, "resume saved draft");
  assert.equal(recovered.draft.version, 1);
  assert.equal(recovered.draft.answers[0].answer, "B");

  assert.equal(expectStatus(await http("student/attempts/start", {
    method: "POST", body: firstBody,
  }), 200, "same-key retry").id, first.data.id);
  expectStatus(await http("student/attempts/start", {
    method: "POST", body: { ...firstBody, startKey: randomUUID() },
  }), 409, "duplicate email");

  const submitted = expectStatus(await http("student/attempts/submit", {
    method: "POST", cookie: first.cookie,
    body: { version: 2, answers: correctAnswers, reason: "student" },
  }), 200, "final submit");
  assert.equal(submitted.status, "submitted");
  const savedSubmitted = await Attempt.findById(first.data.id).lean();
  assert.equal(savedSubmitted.score, 1);
  assert.equal(savedSubmitted.answers[0].answer, "B");
  const repeat = expectStatus(await http("student/attempts/submit", {
    method: "POST", cookie: first.cookie,
    body: { version: 3, answers: wrongAnswers, reason: "student" },
  }), 200, "final submit retry");
  assert.equal(repeat.attemptId, first.data.id);
  assert.equal((await Attempt.findById(first.data.id).lean()).answers[0].answer, "B");

  expectStatus(await http("admin/attempts/" + first.data.id, {
    method: "DELETE",
  }), 401, "unauthorized admin delete");
  expectStatus(await remove(first.data.id), 200, "admin deletes submitted attempt");
  expectStatus(await http("student/attempts/current", {
    cookie: first.cookie,
  }), 401, "deleted cookie rejected");
  const reset = await start({ ...firstBody, startKey: randomUUID() });
  assert.notEqual(reset.data.id, first.data.id);
  expectStatus(await remove(reset.data.id), 200, "admin deletes active attempt");

  // Concurrent starts for the same normalized email must reserve exactly one.
  const contender = details("race");
  const [r1, r2] = await Promise.all([
    http("student/attempts/start", { method: "POST", body: contender }),
    http("student/attempts/start", {
      method: "POST",
      body: { ...contender, email: contender.email.toUpperCase(), startKey: randomUUID() },
    }),
  ]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(await Attempt.countDocuments({ quiz: quiz._id, email: contender.email }), 1);
  const winningId = r1.status === 200 ? r1.data.data.id : r2.data.data.id;
  expectStatus(await remove(winningId), 200, "admin deletes raced attempt");

  // Network retry of one violation must not count twice, even when concurrent.
  const violatorBody = details("violation");
  const violator = await start(violatorBody);
  const event = { eventId: randomUUID(), type: "tab_hidden" };
  const [v1, v2] = await Promise.all([
    http("student/attempts/violations", {
      method: "POST", cookie: violator.cookie, body: event,
    }),
    http("student/attempts/violations", {
      method: "POST", cookie: violator.cookie, body: event,
    }),
  ]);
  expectStatus(v1, 200, "first violation");
  expectStatus(v2, 200, "duplicated violation retry");
  assert.equal((await Attempt.findById(violator.data.id).lean()).violationCount, 1);
  expectStatus(await http("student/attempts/violations", {
    method: "POST", cookie: violator.cookie,
    body: { eventId: randomUUID(), type: "window_blur" },
  }), 200, "second violation");
  const terminated = expectStatus(await http("student/attempts/violations", {
    method: "POST", cookie: violator.cookie,
    body: { eventId: randomUUID(), type: "fullscreen_exit" },
  }), 200, "violation threshold");
  assert.equal(terminated.status, "terminated");
  assert.equal(terminated.violationCount, 3);
  const stopped = expectStatus(await http("student/attempts/current", {
    cookie: violator.cookie,
  }), 200, "terminated current");
  assert.equal(stopped.attempt.status, "terminated");
  assert.deepEqual(stopped.questions, []);
  expectStatus(await http("student/attempts/draft", {
    method: "PUT", cookie: violator.cookie,
    body: { version: 1, answers: correctAnswers },
  }), 409, "draft blocked after violation limit");
  expectStatus(await http("student/attempts/submit", {
    method: "POST", cookie: violator.cookie,
    body: { version: 1, answers: correctAnswers, reason: "student" },
  }), 409, "submit blocked after violation limit");
  const actualTerminated = await Attempt.findById(violator.data.id).lean();
  assert.equal(actualTerminated.submitReason, "violation_limit");
  assert.equal(actualTerminated.status, "terminated");
  assert.equal(actualTerminated.violations.length, 3);
  expectStatus(await remove(violator.data.id), 200, "admin deletes terminated attempt");
  const retake = await start({ ...violatorBody, startKey: randomUUID() });
  assert.notEqual(retake.data.id, violator.data.id);
  expectStatus(await remove(retake.data.id), 200, "admin deletes reattempt");

  // Expiry is server-enforced. A late request cannot replace persisted answers.
  const expiry = await start(details("expired"));
  expectStatus(await http("student/attempts/draft", {
    method: "PUT", cookie: expiry.cookie,
    body: { version: 1, answers: correctAnswers },
  }), 200, "persist before expiry");
  await Attempt.updateOne({ _id: expiry.data.id }, {
    $set: { expiresAt: new Date(Date.now() - 1000) },
  });
  const expiredFinal = expectStatus(await http("student/attempts/submit", {
    method: "POST", cookie: expiry.cookie,
    body: { version: 2, answers: wrongAnswers, reason: "student" },
  }), 200, "late submit finalized saved draft");
  assert.equal(expiredFinal.submitReason, "time_ended");
  const afterExpiry = await Attempt.findById(expiry.data.id).lean();
  assert.equal(afterExpiry.answers[0].answer, "B");
  assert.equal(afterExpiry.score, 1);
  expectStatus(await remove(expiry.data.id), 200, "admin deletes expired submission");

  assert.equal(await Attempt.countDocuments({ quiz: quiz._id }), 0);
  console.info(JSON.stringify({
    test: "Real MongoDB attempt lifecycle",
    isolatedDatabase: "quiz_hub_test",
    checksPassed: [
      "one-hour deadline", "draft recovery", "idempotent submission",
      "concurrent email uniqueness", "atomic violation retries and termination",
      "post-termination write protection", "admin delete and reattempt",
      "deleted JWT revocation", "server-owned expiry finalization",
    ],
  }, null, 2));
}

try {
  await run();
} catch (error) {
  // Errors may contain connection URIs: redact and truncate diagnostics.
  const safeMessage = String(error?.message || "Unknown error")
    .replace(/mongodb(?:\+srv)?:\/\/\S+/gi, "[REDACTED]").slice(0, 220);
  console.error("LIFECYCLE TEST FAILED:", safeMessage);
  process.exitCode = 1;
} finally {
  if (server) {
    try { await new Promise((resolve, reject) =>
      server.close((error) => error ? reject(error) : resolve())); }
    catch { process.exitCode = 1; }
  }
  try {
    if (mongoose.connection.db?.databaseName === "quiz_hub_test") {
      if (quiz?._id) {
        await Attempt.deleteMany({ quiz: quiz._id });
        await Quiz.deleteOne({ _id: quiz._id });
      }
      if (admin?._id) await Admin.deleteOne({ _id: admin._id });
    }
    await disconnectDB();
  } catch {
    console.error("Fixture cleanup failed. Inspect only quiz_hub_test.");
    process.exitCode = 1;
  }
}
