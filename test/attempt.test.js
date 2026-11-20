import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { startAttemptSchema } from "../src/validations/attempt.validation.js";
import { Attempt } from "../src/models/attempt.model.js";
import { Quiz } from "../src/models/quiz.model.js";
import { Slot } from "../src/models/slot.model.js";
import { studentQuestions } from "../src/utils/studentQuestions.js";
import { generateAttemptJwt } from "../src/utils/generateJwt.js";

const origin = "http://localhost:5173";
const secret = "unique-testing-secret-over-32-characters-and-more";
const quizId = new mongoose.Types.ObjectId().toString();
const slotId = new mongoose.Types.ObjectId();
const attemptId = new mongoose.Types.ObjectId();
const startKey = randomUUID();

const candidate = { quizId, studentName: "Ahmed Ali", rollNo: "00123", startKey };

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

test("numeric roll number is stored as a string and leading zeros remain intact", () => {
  const { error, value } = startAttemptSchema.validate(candidate);
  assert.equal(error, undefined);
  assert.equal(value.rollNo, "00123");
});

test("invalid roll numbers and JSON numbers are rejected", () => {
  for (const rollNo of ["123A", "12-3", "12.3", "-12", "+12", "1e5", "", "12 3", "  ", "9".repeat(26), 123]) {
    assert.ok(startAttemptSchema.validate({ ...candidate, rollNo }).error, String(rollNo));
  }
});

test("client retry key must be a UUIDv4", () => {
  assert.ok(startAttemptSchema.validate({ ...candidate, startKey: "123" }).error);
});

test("database uniqueness is one roll number per quiz, regardless of slot", () => {
  assert.ok(Attempt.schema.indexes().some(([index, settings]) =>
    index.quiz === 1 && index.rollNo === 1 && settings.unique === true
  ));
});

test("student API rejects invalid roll number before database query", async () => {
  await withServer(async (base) => {
    const response = await post(base, { ...candidate, rollNo: "CS-123" });
    assert.equal(response.status, 400);
  });
});

test("no attempt can be read without its signed cookie", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/student/attempts/current");
    assert.equal(response.status, 401);
  });
});

test("no-origin browser POSTs are rejected", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/student/attempts/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(candidate),
    });
    assert.equal(response.status, 403);
  });
});

test("safe question delivery does not expose correct answers or coding tests", () => {
  const qId = new mongoose.Types.ObjectId();
  const codeId = new mongoose.Types.ObjectId();
  const quiz = {
    randomizeQuestions: true, randomizeOptions: true,
    questions: [{
      _id: qId, type: "mcq", prompt: "Pick one", code: "",
      options: ["A", "B", "C"], correctAnswer: "C",
      testCases: [{ expected: "secret" }], points: 1, timeSeconds: 45,
    }, {
      _id: codeId, type: "coding", prompt: "Write a function",
      starterCode: "function f() {}", language: "javascript",
      testCases: [{ input: "hidden", expected: "hidden" }],
      points: 3, timeSeconds: 90,
    }],
  };

  const first = studentQuestions(quiz, attemptId);
  const again = studentQuestions(quiz, attemptId);
  assert.deepEqual(first, again, "Refresh must preserve question and option order");
  assert.equal(first.length, 2);
  for (const q of first) {
    assert.ok(!("correctAnswer" in q));
    assert.ok(!("testCases" in q));
    assert.ok(!("startKeyHash" in q));
  }
});

test("start reserves a unique seat; retries are idempotent and do not consume seats", async () => {
  const original = {
    attemptFind: Attempt.findOne,
    attemptExists: Attempt.exists,
    quizFind: Quiz.findOne,
    slotFind: Slot.findOne,
    create: Attempt.create,
  };
  const expires = new Date(Date.now() + 40 * 60_000);
  let saved = null;
  const seats = [];
  let collisions = 0;

  Attempt.findOne = () => ({ select: async () => saved });
  Attempt.exists = async () => null;
  Quiz.findOne = () => ({ select: async () => ({ _id: quizId, durationMinutes: 30 }) });
  Slot.findOne = () => ({
    select: () => ({ lean: async () => ({ _id: slotId, endsAt: expires, capacity: 250 }) }),
  });
  Attempt.create = async (doc) => {
    if (!collisions++) {
      const err = new Error("Seat already occupied");
      err.code = 11000;
      err.keyPattern = { slot: 1, seatNumber: 1 };
      throw err;
    }
    seats.push(doc.seatNumber);
    saved = { _id: attemptId, ...doc, status: "started" };
    return saved;
  };

  try {
    await withServer(async (base) => {
      const first = await post(base, candidate);
      assert.equal(first.status, 200);
      assert.equal((await first.json()).data.rollNo, "00123");
      assert.match(first.headers.get("set-cookie"), /HttpOnly/);
      assert.equal(seats.length, 1);
      assert.ok(seats[0] >= 1 && seats[0] <= 250);

      const retry = await post(base, candidate);
      assert.equal(retry.status, 200);
      assert.equal((await retry.json()).data.id, String(attemptId));
      assert.equal(seats.length, 1, "Retry must not create a second seat");

      const other = await post(base, { ...candidate, startKey: randomUUID() });
      assert.equal(other.status, 409);
      assert.equal(seats.length, 1);
      assert.equal(saved.startKeyHash, createHash("sha256").update(startKey).digest("hex"));
    });
  } finally {
    Attempt.findOne = original.attemptFind;
    Attempt.exists = original.attemptExists;
    Quiz.findOne = original.quizFind;
    Slot.findOne = original.slotFind;
    Attempt.create = original.create;
  }
});

test("all occupied seats return 409 without overbooking", async () => {
  const original = {
    attemptFind: Attempt.findOne,
    attemptExists: Attempt.exists,
    quizFind: Quiz.findOne,
    slotFind: Slot.findOne,
    create: Attempt.create,
  };
  let attemptedSeats = 0;
  Attempt.findOne = () => ({ select: async () => null });
  Attempt.exists = async () => null;
  Quiz.findOne = () => ({ select: async () => ({ durationMinutes: 30 }) });
  Slot.findOne = () => ({
    select: () => ({ lean: async () => ({
      _id: slotId, endsAt: new Date(Date.now() + 60_000), capacity: 3,
    }) }),
  });
  Attempt.create = async () => {
    attemptedSeats += 1;
    const err = new Error("Seat already occupied");
    err.code = 11000;
    err.keyPattern = { slot: 1, seatNumber: 1 };
    throw err;
  };

  try {
    await withServer(async (base) => {
      const response = await post(base, candidate);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).message, "Exam slot is full");
      assert.equal(attemptedSeats, 3);
    });
  } finally {
    Attempt.findOne = original.attemptFind;
    Attempt.exists = original.attemptExists;
    Quiz.findOne = original.quizFind;
    Slot.findOne = original.slotFind;
    Attempt.create = original.create;
  }
});

test("a unique slot-seat index prevents concurrent overbooking", () => {
  const seatIndex = Attempt.schema.indexes().find(([fields]) =>
    fields.slot === 1 && fields.seatNumber === 1);
  assert.ok(seatIndex, "Missing slot+seatNumber index");
  assert.equal(seatIndex[1].unique, true);
  assert.deepEqual(seatIndex[1].partialFilterExpression, {
    seatNumber: { $type: "number" },
  });
});

test("expired attempts cannot fetch questions even with a valid cookie", async () => {
  const original = Attempt.findById;
  Attempt.findById = () => ({
    lean: async () => ({
      _id: attemptId,
      quiz: new mongoose.Types.ObjectId(quizId),
      slot: slotId,
      rollNo: "00123",
      studentName: "Ahmed Ali",
      status: "started",
      startedAt: new Date(Date.now() - 3600_000),
      expiresAt: new Date(Date.now() - 1000),
    }),
  });

  try {
    await withServer(async (base) => {
      const token = generateAttemptJwt({ _id: attemptId }, secret);
      const response = await fetch(base + "/api/v1/student/attempts/current", {
        headers: { Cookie: "quiz_hub_attempt=" + token },
      });
      assert.equal(response.status, 200);
      const data = (await response.json()).data;
      assert.equal(data.attempt.status, "expired");
      assert.deepEqual(data.questions, []);
      assert.ok(Number.isFinite(Date.parse(data.serverNow)), "Server time must be present for expired sessions");
    });
  } finally {
    Attempt.findById = original;
  }
});
