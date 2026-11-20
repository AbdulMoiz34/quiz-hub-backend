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
  const indexes = await Attempt.collection.indexes();
  const emailIndex = indexes.find((index) => index.key.quiz === 1 && index.key.email === 1);
  assert.ok(emailIndex?.unique, "Missing unique {quiz,email} index");
  assert.ok(!indexes.some((index) => index.key.rollNo === 1 || index.key.seatNumber === 1),
    "Obsolete attempt indexes detected. Run the documented migration on quiz_hub_test.");

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
  const adminCookie = "quiz_hub_admin=" + generateAdminJwt(admin, secret);

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

  // Admin creates a draft and publishes it via authenticated HTTP endpoints.
  // No direct model insert for quiz fixtures: this tests real admin routing and Joi.
  const draftBody = {
    title: "Lifecycle Integration " + id,
    durationMinutes: 60,
    maxViolations: 3,
    questions: [
      { type: "mcq", prompt: "Select B", options: ["A", "B"], correctAnswer: "B", points: 1 },
      { type: "short_text", prompt: "Explain your choice", points: 2 },
    ],
  };
  const created = expectStatus(await http("admin/quizzes", {
    method: "POST", cookie: adminCookie, body: draftBody,
  }), 201, "admin creates quiz");
  const quizId = created.id;
  quiz = await Quiz.findById(quizId);
  assert.ok(quiz);
  const questionId = String(quiz.questions[0]._id);
  const manualQuestionId = String(quiz.questions[1]._id);
  const correctAnswers = [{ questionId, answer: "B" }];
  const wrongAnswers = [{ questionId, answer: "A" }];

  const unpublished = expectStatus(await http("student/quizzes"), 200, "published quizzes");
  assert.ok(!unpublished.some((entry) => entry.id === quizId),
    "Draft quiz must never be listed publicly");
  expectStatus(await http("admin/quizzes/" + quizId), 401, "quiz detail requires admin");
  const privateQuiz = expectStatus(await http("admin/quizzes/" + quizId, {
    cookie: adminCookie,
  }), 200, "admin can view quiz questions");
  assert.equal(privateQuiz.questions[0].correctAnswer, "B");
  const published = expectStatus(await http("admin/quizzes/" + quizId + "/publish", {
    method: "PATCH", cookie: adminCookie, body: { isPublished: true },
  }), 200, "admin publishes quiz");
  assert.equal(published.isPublished, true);
  const visible = expectStatus(await http("student/quizzes"), 200, "published quizzes available");
  assert.ok(visible.some((entry) => entry.id === quizId && entry.durationMinutes === 60));
  assert.ok(!visible.some((entry) => entry.correctAnswer != null),
    "Public quiz listing must not include answer keys");

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
  assert.equal(current.questions.length, 2);
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

  // Admin views list, statistics, detailed results and CSV after submission.
  const statistics = expectStatus(await http("admin/results/stats?quizId=" + quizId, {
    cookie: adminCookie,
  }), 200, "admin results statistics");
  assert.equal(statistics.totalAttempts, 1);
  assert.equal(statistics.submitted, 1);
  const page = expectStatus(await http("admin/results?quizId=" + quizId, {
    cookie: adminCookie,
  }), 200, "admin lists quiz results");
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].email, firstBody.email);
  assert.ok(!("answers" in page.items[0]));
  expectStatus(await http("admin/attempts/" + first.data.id), 401, "attempt review requires admin");
  const reviewed = expectStatus(await http("admin/attempts/" + first.data.id, {
    cookie: adminCookie,
  }), 200, "admin reviews attempt");
  assert.equal(reviewed.answers[0].answer, "B");
  const csvResponse = await fetch(base + "/api/v1/admin/results/export?quizId=" + quizId, {
    headers: { Cookie: adminCookie, Origin: origin },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert.ok(csv.includes(firstBody.email));
  assert.ok(!csv.includes("startKeyHash"));

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

  // Submitted short answers remain pending until the admin awards manual marks.
  const manual = await start(details("manual"));
  const allAnswers = [...correctAnswers, { questionId: manualQuestionId, answer: "Because B is correct." }];
  const manualReceipt = expectStatus(await http("student/attempts/submit", {
    method: "POST", cookie: manual.cookie,
    body: { version: 1, answers: allAnswers, reason: "student" },
  }), 200, "manual review submission");
  assert.equal(manualReceipt.status, "submitted");
  const toReview = await Attempt.findById(manual.data.id).lean();
  assert.equal(toReview.pendingReviewCount, 1);
  assert.equal(toReview.gradingStatus, "pending_review");
  assert.equal(toReview.score, 1);
  const grade = expectStatus(await http("admin/attempts/" + manual.data.id + "/grade", {
    method: "PATCH", cookie: adminCookie,
    body: { questionId: manualQuestionId, pointsAwarded: 2 },
  }), 200, "admin manually grades short answer");
  assert.equal(grade.score, 3);
  assert.equal(grade.gradingStatus, "graded");
  assert.equal(grade.pendingReviewCount, 0);
  expectStatus(await remove(manual.data.id), 200, "admin deletes graded attempt");

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
      "admin creation and publish", "one-hour deadline", "draft recovery",
      "admin results, CSV and manual grading", "idempotent submission",
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
