import mongoose from "mongoose";
import { Attempt } from "../models/attempt.model.js";
import { getQuizQuestionIds } from "../utils/attemptAnswers.js";
import { gradeAttempt, manualGradeMap } from "../utils/gradeAttempt.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

const isId = mongoose.isObjectIdOrHexString;

export const getAttemptForReview = async (req, res) => {
  if (!isId(req.params.id)) return errorResponse(res, 400, "Invalid attempt ID");

  const attempt = await Attempt.findById(req.params.id)
    .select("quiz slot studentName rollNo status startedAt expiresAt submittedAt submitReason answers score maxScore objectiveScore gradingStatus pendingReviewCount manualGrades gradingVersion")
    .lean();

  if (!attempt) return errorResponse(res, 404, "Attempt not found");
  return successResponse(res, 200, "Attempt details", attempt);
};

export const gradeManualAnswer = async (req, res) => {
  if (!isId(req.params.id)) return errorResponse(res, 400, "Invalid attempt ID");

  const attempt = await Attempt.findById(req.params.id)
    .select("quiz status answers manualGrades gradingVersion")
    .lean();

  if (!attempt) return errorResponse(res, 404, "Attempt not found");
  if (attempt.status !== "submitted") {
    return errorResponse(res, 409, "Only submitted attempts can be graded");
  }

  const quiz = await getQuizQuestionIds(attempt.quiz);
  if (!quiz) return errorResponse(res, 404, "Quiz not found");

  const { questionId, pointsAwarded } = req.body;
  const question = quiz.questions.find((q) => String(q._id) === questionId);
  if (!question || !["short_text", "coding"].includes(question.type)) {
    return errorResponse(res, 400, "Question does not support manual grading");
  }
  if (pointsAwarded > question.points) {
    return errorResponse(res, 400, "Awarded points exceed the question's marks");
  }
  if (!attempt.answers.some((item) =>
    String(item.questionId) === questionId && String(item.answer).trim()
  )) {
    return errorResponse(res, 409, "Cannot award marks for an unanswered question");
  }

  const grades = { ...manualGradeMap(attempt.manualGrades), [questionId]: pointsAwarded };
  const scoring = gradeAttempt(quiz.questions, attempt.answers, grades);
  const version = attempt.gradingVersion || 0;

  // Compare-and-swap: simultaneous admin reviews must not lose grade updates.
  const updated = await Attempt.findOneAndUpdate(
    {
      _id: attempt._id,
      status: "submitted",
      gradingVersion: version === 0 ? { $in: [null, 0] } : version,
    },
    { $set: { manualGrades: grades, ...scoring }, $inc: { gradingVersion: 1 } },
    { new: true }
  ).select("score maxScore objectiveScore gradingStatus pendingReviewCount manualGrades gradingVersion");

  if (!updated) return errorResponse(res, 409, "Grades changed. Refresh and try again");
  return successResponse(res, 200, "Answer graded", updated);
};
