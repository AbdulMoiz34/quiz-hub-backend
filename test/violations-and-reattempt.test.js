import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Attempt } from "../src/models/attempt.model.js";
import { Quiz } from "../src/models/quiz.model.js";
import { Admin } from "../src/models/admin.model.js";
import { generateAttemptJwt, generateAdminJwt } from "../src/utils/generateJwt.js";
import { violationSchema } from "../src/validations/attempt.validation.js";

const origin = "http://localhost:5173";
const secret = "long-quiz-violation-and-reset-testing-secret-123";
const quizId = new mongoose.Types.ObjectId();
const attemptId = new mongoose.Types.ObjectId();
const admin = { _id: new mongoose.Types.ObjectId(), email: "admin@example.test", sessionVersion: 0 };

function mockQuery(value) {
  return { select() { return this; }, lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); } };
}

async function withServer(callback) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret,
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await callback("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

function request(base, path, method, body, cookie) {
  return fetch(base + path, {
    method,
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("violation payload accepts only a known event and UUID", () => {
  assert.equal(violationSchema.validate({
    eventId: randomUUID(), type: "tab_hidden",
  }).error, undefined);
  for (const body of [
    { eventId: "not-uuid", type: "tab_hidden" },
    { eventId: randomUUID(), type: "client_says_terminated" },
    { eventId: randomUUID(), type: "window_blur", violationCount: 100 },
  ]) {
    assert.ok(violationSchema.validate(body).error);
  }
});

test("server increments unique violations atomically and stops at threshold", async () => {
  const originals = {
    byId: Attempt.findById, update: Attempt.findOneAndUpdate, quiz: Quiz.findById,
  };
  let state = {
    _id: attemptId, quiz: quizId, status: "started",
    studentName: "A Student", email: "student@example.test", phone: "+923001234567",
    startedAt: new Date(), expiresAt: new Date(Date.now() + 3600_000),
    violationCount: 0, violations: [], answers: [], draftVersion: 0,
  };
  let writes = 0;
  Attempt.findById = () => mockQuery(state);
  Quiz.findById = () => mockQuery({ maxViolations: 3 });
  Attempt.findOneAndUpdate = (filter, pipeline) => {
    assert.equal(filter.status, "started");
    assert.ok(pipeline[0].$set.violationCount.$add);
    assert.ok(pipeline[0].$set.status.$cond);
    if (!state || state.status !== "started" ||
        state.expiresAt <= filter.expiresAt.$gt ||
        state.violations.some((event) => event.eventId === filter["violations.eventId"].$ne)) {
      return mockQuery(null);
    }
    const added = pipeline[0].$set.violations.$concatArrays[1][0];
    writes++;
    state = { ...state,
      violations: [...state.violations, added],
      violationCount: state.violationCount + 1,
      status: state.violationCount + 1 >= 3 ? "terminated" : "started",
    };
    return mockQuery(state);
  };

  try {
    await withServer(async (base) => {
      const cookie = "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret);
      const url = "/api/v1/student/attempts/violations";
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      const first = await request(base, url, "POST", { eventId: ids[0], type: "tab_hidden" }, cookie);
      assert.equal(first.status, 200);
      assert.equal((await first.json()).data.violationCount, 1);
      const duplicate = await request(base, url, "POST", { eventId: ids[0], type: "tab_hidden" }, cookie);
      assert.equal(duplicate.status, 200);
      assert.equal(writes, 1);

      await request(base, url, "POST", { eventId: ids[1], type: "window_blur" }, cookie);
      const last = await request(base, url, "POST", { eventId: ids[2], type: "fullscreen_exit" }, cookie);
      assert.equal(last.status, 200);
      const result = (await last.json()).data;
      assert.equal(result.status, "terminated");
      assert.equal(result.violationCount, 3);
      assert.equal(writes, 3);

      const retryLast = await request(base, url, "POST", { eventId: ids[2], type: "fullscreen_exit" }, cookie);
      assert.equal(retryLast.status, 200);
      assert.equal((await retryLast.json()).data.violationCount, 3);
      const fourth = await request(base, url, "POST", {
        eventId: randomUUID(), type: "tab_hidden",
      }, cookie);
      assert.equal(fourth.status, 409);
      assert.equal(writes, 3);

      const stopped = await request(base, "/api/v1/student/attempts/submit", "POST", {
        version: 1, answers: [], reason: "student",
      }, cookie);
      assert.equal(stopped.status, 409);
      const current = await fetch(base + "/api/v1/student/attempts/current", {
        headers: { Cookie: cookie },
      });
      assert.equal(current.status, 200);
      assert.deepEqual((await current.json()).data.questions, []);
    });
  } finally {
    Attempt.findById = originals.byId;
    Attempt.findOneAndUpdate = originals.update;
    Quiz.findById = originals.quiz;
  }
});

test("admin can delete a submitted attempt; old cookie revoked, email reusable", async () => {
  const originals = {
    byId: Attempt.findById, deleted: Attempt.findOneAndDelete,
    find: Attempt.findOne, create: Attempt.create,
    quiz: Quiz.findOne, admin: Admin.findById,
  };
  const oldKey = randomUUID();
  let state = {
    _id: attemptId, quiz: quizId, status: "submitted",
    studentName: "Student", email: "student@example.test", phone: "+923001234567",
    startKeyHash: createHash("sha256").update(oldKey).digest("hex"),
    startedAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
  };
  Attempt.findById = () => mockQuery(state);
  Attempt.findOne = ({ quiz, email }) => mockQuery(
    state && String(state.quiz) === String(quiz) && state.email === email ? state : null
  );
  Attempt.findOneAndDelete = () => ({
    select: async () => { const previous = state; state = null; return previous; },
  });
  Quiz.findOne = () => mockQuery({ durationMinutes: 60 });
  Attempt.create = async (doc) => {
    assert.equal(state, null, "An old attempt must be removed before a fresh one starts");
    state = { _id: new mongoose.Types.ObjectId(), ...doc, status: "started" };
    return state;
  };
  Admin.findById = () => mockQuery(admin);

  try {
    await withServer(async (base) => {
      const adminCookie = "quiz_hub_admin=" + generateAdminJwt(admin, secret);
      const studentCookie = "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret);
      const url = "/api/v1/admin/attempts/" + attemptId;

      const unauthorized = await fetch(base + url, { method: "DELETE", headers: { Origin: origin } });
      assert.equal(unauthorized.status, 401);
      assert.equal(state.status, "submitted");

      const deleted = await fetch(base + url, {
        method: "DELETE", headers: { Origin: origin, Cookie: adminCookie },
      });
      assert.equal(deleted.status, 200);
      assert.equal(state, null);

      const revoked = await fetch(base + "/api/v1/student/attempts/current", {
        headers: { Cookie: studentCookie },
      });
      assert.equal(revoked.status, 401);

      const fresh = await request(base, "/api/v1/student/attempts/start", "POST", {
        quizId: String(quizId), studentName: "Student",
        email: "Student@Example.test", phone: "+923001234567",
        startKey: randomUUID(),
      }, "");
      assert.equal(fresh.status, 200);
      const result = (await fresh.json()).data;
      assert.equal(result.email, "student@example.test");
      assert.notEqual(result.id, String(attemptId));
    });
  } finally {
    Attempt.findById = originals.byId;
    Attempt.findOneAndDelete = originals.deleted;
    Attempt.findOne = originals.find;
    Attempt.create = originals.create;
    Quiz.findOne = originals.quiz;
    Admin.findById = originals.admin;
  }
});
