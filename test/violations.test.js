import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Attempt } from "../src/models/attempt.model.js";
import { Quiz } from "../src/models/quiz.model.js";
import { generateAttemptJwt } from "../src/utils/generateJwt.js";
import { violationSchema } from "../src/validations/violation.validation.js";

const origin = "http://localhost:5173";
const secret = "violation-test-secret-over-32-characters-012345";
const attemptId = new mongoose.Types.ObjectId();
const quizId = new mongoose.Types.ObjectId();
const questionId = new mongoose.Types.ObjectId();

function query(value) {
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
  try { await fn("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((r) => server.close(r)); }
}

test("violation payload requires UUID event and a recognized browser event", () => {
  assert.equal(violationSchema.validate({
    eventId: randomUUID(), type: "tab_hidden",
  }).error, undefined);
  assert.ok(violationSchema.validate({
    eventId: randomUUID(), type: "free_points",
  }).error);
  assert.ok(violationSchema.validate({
    eventId: "not-uuid", type: "window_blur",
  }).error);
});

test("server idempotently counts violations and atomically terminates at limit", async () => {
  const originals = {
    findById: Attempt.findById,
    update: Attempt.findOneAndUpdate,
    quizById: Quiz.findById,
  };
  let state = {
    _id: attemptId, quiz: quizId, status: "started", draftVersion: 1,
    violationCount: 0, maxViolations: 2, violationEventIds: [],
    startedAt: new Date(Date.now() - 120_000),
    expiresAt: new Date(Date.now() + 300_000),
    answers: [{ questionId: String(questionId), answer: "B" }],
  };
  Attempt.findById = () => query({ ...state, violationEventIds: [...state.violationEventIds] });
  Quiz.findById = () => query({
    questionCount: 1,
    questions: [{ _id: questionId, type: "mcq", correctAnswer: "B", points: 1 }],
  });
  Attempt.findOneAndUpdate = (filter, update) => {
    if (state.status !== filter.status ||
      state.violationCount !== (filter.violationCount.$in?.[0] ?? filter.violationCount) ||
      state.violationEventIds.includes(update.$addToSet.violationEventIds)) {
      return query(null);
    }
    state = {
      ...state, ...update.$set,
      violationCount: state.violationCount + update.$inc.violationCount,
      violationEventIds: [...state.violationEventIds, update.$addToSet.violationEventIds],
    };
    return query({ ...state });
  };

  try {
    await withServer(async (base) => {
      const cookie = "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret);
      const send = async (eventId, type = "tab_hidden") => {
        const r = await fetch(base + "/api/v1/student/attempts/violations", {
          method: "POST",
          headers: {
            Origin: origin, Cookie: cookie, "Content-Type": "application/json",
            "X-Expected-Attempt-Id": String(attemptId),
          },
          body: JSON.stringify({ eventId, type }),
        });
        return { status: r.status, data: (await r.json()).data };
      };

      const a = randomUUID();
      const first = await send(a);
      assert.equal(first.status, 200);
      assert.equal(first.data.violationCount, 1);
      const retry = await send(a);
      assert.equal(retry.data.violationCount, 1);

      const second = await send(randomUUID(), "window_blur");
      assert.equal(second.status, 200);
      assert.equal(second.data.status, "terminated");
      assert.equal(second.data.violationCount, 2);
      assert.equal(state.submitReason, "violation_limit");
      assert.equal(state.score, 1);
      assert.equal(state.answeredCount, 1);
      assert.equal(state.violationEventIds.length, 2);
    });
  } finally {
    Attempt.findById = originals.findById;
    Attempt.findOneAndUpdate = originals.update;
    Quiz.findById = originals.quizById;
  }
});

test("different browser tab cannot report against a replaced attempt cookie", async () => {
  const original = Attempt.findById;
  Attempt.findById = () => query({
    _id: attemptId, quiz: quizId, status: "started",
    expiresAt: new Date(Date.now() + 60_000), violationCount: 0, maxViolations: 2,
  });
  try {
    await withServer(async (base) => {
      const response = await fetch(base + "/api/v1/student/attempts/violations", {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret),
          "X-Expected-Attempt-Id": String(new mongoose.Types.ObjectId()),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ eventId: randomUUID(), type: "tab_hidden" }),
      });
      assert.equal(response.status, 409);
    });
  } finally { Attempt.findById = original; }
});
