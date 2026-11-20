import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { quizSchema, quizDetailsSchema, publishSchema } from "../src/validations/quiz.validation.js";
import { createApp } from "../src/app.js";

const validQuiz = {
  title: "HTML Test",
  durationMinutes: 30,
  questions: [{
    type: "mcq",
    prompt: "What does HTML stand for?",
    options: ["HyperText Markup Language", "HyperText Markdown Language"],
    correctAnswer: "HyperText Markup Language",
  }],
};

test("accepts a valid MCQ with server-side answer key", () => {
  const { error, value } = quizSchema.validate(validQuiz);
  assert.equal(error, undefined);
  assert.equal(value.questions[0].correctAnswer, "HyperText Markup Language");
  assert.equal(value.maxViolations, 3);
  assert.equal(value.questions[0].timeSeconds, undefined);
  assert.equal(value.questionTimeSeconds, undefined);
});

test("rejects MCQ without valid answer key", () => {
  const { error } = quizSchema.validate({
    ...validQuiz,
    questions: [{ ...validQuiz.questions[0], correctAnswer: "Not an option" }],
  });
  assert.ok(error);
});

test("rejects duplicate MCQ options", () => {
  const { error } = quizSchema.validate({
    ...validQuiz,
    questions: [{ ...validQuiz.questions[0], options: ["Same", "Same"], correctAnswer: "Same" }],
  });
  assert.ok(error);
});

test("rejects quiz without questions", () => {
  const { error } = quizSchema.validate({ title: "Empty", questions: [] });
  assert.ok(error);
});

test("normalizes true/false question options", () => {
  const { error, value } = quizSchema.validate({
    title: "True or False",
    questions: [{ type: "true_false", prompt: "The earth orbits the sun", correctAnswer: "True" }],
  });
  assert.equal(error, undefined);
  assert.deepEqual(value.questions[0].options, ["True", "False"]);
});

test("admin quiz endpoints require a valid admin cookie", async () => {
  const app = createApp({
    allowedOrigins: ["http://localhost:5173"],
    jwtSecret: "testing-secret-with-over-32-characters-and-randomness",
    nodeEnv: "test",
    cookieSameSite: "lax",
    isDbReady: () => true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const response = await fetch("http://127.0.0.1:" + server.address().port + "/api/v1/admin/quizzes");
    assert.equal(response.status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("publication can be reversed without changing quiz content", () => {
  assert.equal(publishSchema.validate({ isPublished: true }).error, undefined);
  assert.equal(publishSchema.validate({ isPublished: false }).error, undefined);
  assert.ok(publishSchema.validate({ isPublished: "maybe" }).error);
  assert.ok(publishSchema.validate({ isPublished: true, questions: [] }).error);
});

test("details-only updates cannot modify questions, duration or answer keys", () => {
  assert.equal(quizDetailsSchema.validate({ title: "Updated title", description: "Read carefully" }).error, undefined);
  assert.equal(quizDetailsSchema.validate({ description: "" }).error, undefined);
  assert.ok(quizDetailsSchema.validate({}).error);
  assert.ok(quizDetailsSchema.validate({ durationMinutes: 30 }).error);
  assert.ok(quizDetailsSchema.validate({ questions: validQuiz.questions }).error);
  assert.ok(quizDetailsSchema.validate({ isPublished: true }).error);
});
