import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Quiz } from "../src/models/quiz.model.js";

const origin = "http://localhost:5173";
test("GET student quizzes returns published quizzes without requiring slots", async () => {
  const original = Quiz.find;
  const id = new mongoose.Types.ObjectId();
  let filter;
  Quiz.find = (query) => {
    filter = query;
    return {
      select() { return this; },
      sort() { return this; },
      lean: async () => [{
        _id: id, title: "60-minute quiz", description: "",
        durationMinutes: 60, maxViolations: 3, questionCount: 40,
      }],
    };
  };
  const server = createApp({
    allowedOrigins: [origin],
    jwtSecret: "published-quiz-test-secret-over-thirty-two",
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const r = await fetch(
      "http://127.0.0.1:" + server.address().port + "/api/v1/student/quizzes"
    );
    assert.equal(r.status, 200);
    const result = (await r.json()).data;
    assert.deepEqual(filter, { isPublished: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].durationMinutes, 60);
    assert.equal(result[0].questionCount, 40);
    assert.equal(result[0].questionTimeSeconds, undefined);
  } finally {
    Quiz.find = original;
    await new Promise((r) => server.close(r));
  }
});
