import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Admin } from "../src/models/admin.model.js";
import { Attempt } from "../src/models/attempt.model.js";
import { Quiz } from "../src/models/quiz.model.js";
import { generateAdminJwt } from "../src/utils/generateJwt.js";
import { gradeAttempt } from "../src/utils/gradeAttempt.js";
import { manualGradeSchema } from "../src/validations/grading.validation.js";

const q1 = new mongoose.Types.ObjectId();
const q2 = new mongoose.Types.ObjectId();
const q3 = new mongoose.Types.ObjectId();
const attemptId = new mongoose.Types.ObjectId();
const quizId = new mongoose.Types.ObjectId();
const adminId = new mongoose.Types.ObjectId();
const secret = "testing-secret-with-at-least-32-characters-abc123";
const origin = "http://localhost:5173";
const questions = [
  { _id: q1, type: "mcq", points: 2, correctAnswer: "B" },
  { _id: q2, type: "short_text", points: 3, correctAnswer: "hidden" },
  { _id: q3, type: "coding", points: 5, testCases: [{ expected: "secret" }] },
];
const answers = [
  { questionId: String(q1), answer: "B" },
  { questionId: String(q2), answer: "Example explanation" },
  { questionId: String(q3), answer: "console.log(7)", testResults: [{ passed: true }] },
];

test("MCQ scoring uses private answer keys only", () => {
  const result = gradeAttempt(questions, answers);
  assert.deepEqual(result, {
    score: 2, maxScore: 10, objectiveScore: 2,
    pendingReviewCount: 2, gradingStatus: "pending_review",
  });

  const cheated = gradeAttempt(questions, [
    { ...answers[0], answer: "A", score: 999 },
    ...answers.slice(1),
  ]);
  assert.equal(cheated.score, 0);
  assert.equal(cheated.pendingReviewCount, 2);
});

test("manual marks are only counted once explicitly reviewed", () => {
  const result = gradeAttempt(questions, answers, {
    [String(q2)]: 2.5,
    [String(q3)]: 4,
  });
  assert.equal(result.score, 8.5);
  assert.equal(result.objectiveScore, 2);
  assert.equal(result.pendingReviewCount, 0);
  assert.equal(result.gradingStatus, "graded");
});

test("unanswered manual questions do not require admin review", () => {
  const result = gradeAttempt(questions, [{ questionId: String(q1), answer: "B" }]);
  assert.equal(result.score, 2);
  assert.equal(result.pendingReviewCount, 0);
  assert.equal(result.gradingStatus, "graded");
});

test("invalid stored manual marks must never inflate score", () => {
  assert.throws(() => gradeAttempt(questions, answers, { [String(q2)]: 99 }), /outside/);
  assert.throws(() => gradeAttempt(questions, answers, { [String(q2)]: -1 }), /outside/);
  assert.throws(() => gradeAttempt(questions, answers, { [String(q2)]: NaN }), /outside/);
});

test("Joi validates manual grade payload and rejects unexpected fields", () => {
  assert.equal(manualGradeSchema.validate({ questionId: String(q2), pointsAwarded: 2.5 }).error, undefined);
  assert.ok(manualGradeSchema.validate({ questionId: String(q2), pointsAwarded: -1 }).error);
  assert.ok(manualGradeSchema.validate({ questionId: String(q2), pointsAwarded: 101 }).error);
  assert.ok(manualGradeSchema.validate({ questionId: String(q2), pointsAwarded: 1, extra: "x" }).error);
});

function mockQuery(value) {
  return {
    select() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

async function withServer(fn) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret,
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await fn("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("admin attempt review endpoint is protected", async () => {
  await withServer(async (base) => {
    const r = await fetch(base + "/api/v1/admin/attempts/" + attemptId);
    assert.equal(r.status, 401);
  });
});

test("manual grades cannot exceed question points; admin grades update atomically", async () => {
  const original = {
    admin: Admin.findById,
    attempt: Attempt.findById,
    update: Attempt.findOneAndUpdate,
    quiz: Quiz.findById,
  };

  const admin = { _id: adminId, email: "admin@example.com", sessionVersion: 0 };
  const cookie = "quiz_hub_admin=" + generateAdminJwt(admin, secret);
  const saved = {
    _id: attemptId, quiz: quizId, status: "submitted",
    answers, manualGrades: {}, gradingVersion: 0, score: 2,
  };
  let writes = 0;

  Admin.findById = () => mockQuery(admin);
  Attempt.findById = () => mockQuery(saved);
  Quiz.findById = () => mockQuery({ questions });
  Attempt.findOneAndUpdate = (filter, update) => {
    if (filter.status !== saved.status ||
        (filter.gradingVersion.$in && !filter.gradingVersion.$in.includes(saved.gradingVersion)) ||
        (typeof filter.gradingVersion === "number" && filter.gradingVersion !== saved.gradingVersion)) {
      return mockQuery(null);
    }
    writes += 1;
    Object.assign(saved, update.$set);
    saved.gradingVersion += update.$inc.gradingVersion;
    return mockQuery(saved);
  };

  try {
    await withServer(async (base) => {
      const path = base + "/api/v1/admin/attempts/" + attemptId + "/grade";
      const send = (questionId, pointsAwarded) => fetch(path, {
        method: "PATCH",
        headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ questionId, pointsAwarded }),
      });

      const over = await send(String(q2), 4);
      assert.equal(over.status, 400);
      assert.equal(writes, 0);

      const objective = await send(String(q1), 1);
      assert.equal(objective.status, 400);
      assert.equal(writes, 0);

      const first = await send(String(q2), 2.5);
      assert.equal(first.status, 200);
      assert.equal((await first.json()).data.score, 4.5);
      assert.equal(saved.pendingReviewCount, 1);
      assert.equal(writes, 1);

      const second = await send(String(q3), 4);
      assert.equal(second.status, 200);
      const data = (await second.json()).data;
      assert.equal(data.score, 8.5);
      assert.equal(data.gradingStatus, "graded");
      assert.equal(writes, 2);

      const detail = await fetch(base + "/api/v1/admin/attempts/" + attemptId, {
        headers: { Cookie: cookie },
      });
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).data.score, 8.5);
    });
  } finally {
    Admin.findById = original.admin;
    Attempt.findById = original.attempt;
    Attempt.findOneAndUpdate = original.update;
    Quiz.findById = original.quiz;
  }
});
