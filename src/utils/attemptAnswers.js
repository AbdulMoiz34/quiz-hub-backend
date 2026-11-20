import { Quiz } from "../models/quiz.model.js";

export async function getQuizQuestionIds(quizId) {
  const quiz = await Quiz.findById(quizId)
    .select("questions._id questionCount")
    .lean();

  if (!quiz) return null;

  return {
    questionIds: new Set(quiz.questions.map((q) => String(q._id))),
    questionCount: quiz.questionCount,
  };
}

export function answersBelongToQuiz(answers, questionIds) {
  return answers.every((item) => questionIds.has(item.questionId));
}

export function countAnswered(answers = []) {
  return answers.filter((item) => item.answer.trim().length > 0).length;
}

// Mongoose subdocuments and Joi data may have different prototypes.
// Compare just the four persisted answer fields for safe duplicate retries.
export function sameAnswers(saved = [], incoming = []) {
  if (saved.length !== incoming.length) return false;
  return saved.every((item, index) => {
    const other = incoming[index];
    return String(item.questionId) === other.questionId &&
      item.answer === other.answer &&
      item.timeSpent === other.timeSpent &&
      item.timedOut === other.timedOut;
  });
}
