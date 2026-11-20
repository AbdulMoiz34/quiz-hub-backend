import { createHash } from "node:crypto";

// Stable ordering per attempt: the same student sees the same order on refresh.
function stableShuffle(items, seed, getKey) {
  return [...items].sort((a, b) => {
    const hash = (item) => createHash("sha256")
      .update(seed + ":" + getKey(item)).digest("hex");
    return hash(a).localeCompare(hash(b));
  });
}

// Explicit allowlist: correctAnswer, hidden testCases and other private
// question metadata must NEVER be returned to a student's browser.
export function studentQuestions(quiz, attemptId) {
  let questions = quiz.questions.map((question) => ({
    id: String(question._id),
    type: question.type,
    prompt: question.prompt,
    code: question.code || "",
    options: [...(question.options || [])],
    points: question.points,
    starterCode: question.starterCode || "",
    language: question.language || "javascript",
  }));

  if (quiz.randomizeOptions) {
    questions = questions.map((question) => ({
      ...question,
      options: stableShuffle(question.options, String(attemptId) + ":" + question.id, (choice) => choice),
    }));
  }
  if (quiz.randomizeQuestions) {
    questions = stableShuffle(questions, String(attemptId), (question) => question.id);
  }
  return questions;
}
