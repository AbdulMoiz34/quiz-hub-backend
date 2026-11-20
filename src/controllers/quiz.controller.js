import mongoose from "mongoose";
import { Quiz } from "../models/quiz.model.js";
import { Attempt } from "../models/attempt.model.js";
import { successResponse, errorResponse } from "../utils/responseHandler.js";

// The full question bank (including answer keys) is accessible to admins only.
// Student-facing question delivery will be added with verified exam attempts.

export const createQuiz = async (req, res) => {
  const quiz = await Quiz.create({ ...req.body, questionCount: req.body.questions.length });
  return successResponse(res, 201, "Quiz created", { id: String(quiz._id) });
};

export const listQuizzes = async (_req, res) => {
  const quizzes = await Quiz.find()
    .select("title description durationMinutes maxViolations isPublished resultsPublished createdAt questionCount")
    .sort({ createdAt: -1 })
    .lean();
  return successResponse(res, 200, "Quizzes fetched", quizzes);
};

export const getQuiz = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  const quiz = await Quiz.findById(req.params.id).lean();
  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  // The admin editor needs this safeguard before allowing question changes.
  const hasAttempts = Boolean(await Attempt.exists({ quiz: quiz._id }));
  return successResponse(res, 200, "Quiz fetched", { ...quiz, hasAttempts });
};

export const updateQuiz = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  // Question IDs, answer keys, timing and scoring must remain stable once
  // any candidate has attempted the quiz—even if it is later unpublished.
  if (await Attempt.exists({ quiz: req.params.id })) {
    return errorResponse(res, 409, "This quiz already has attempts. Only title and instructions can be edited");
  }
  const quiz = await Quiz.findOneAndUpdate(
    { _id: req.params.id, isPublished: false },
    { $set: { ...req.body, questionCount: req.body.questions.length } },
    { returnDocument: "after", runValidators: true }
  );
  if (!quiz) return errorResponse(res, 409, "Unpublish the quiz before editing questions or settings");
  return successResponse(res, 200, "Quiz updated", { id: String(quiz._id) });
};

// Safe to change even after attempts begin: does not alter grading or questions.
export const updateQuizDetails = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  const quiz = await Quiz.findByIdAndUpdate(
    req.params.id, { $set: req.body }, { returnDocument: "after", runValidators: true }
  ).select("title description isPublished");
  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  return successResponse(res, 200, "Quiz details updated", { id: String(quiz._id) });
};

// Unpublishing stops new registrations; existing exam cookies keep working.
// This never deletes attempts or changes the question bank/answer keys.
export const publishQuiz = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  const { isPublished } = req.body;
  const quiz = await Quiz.findByIdAndUpdate(
    req.params.id, { $set: { isPublished } }, { returnDocument: "after", runValidators: true }
  ).select("title isPublished");
  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  return successResponse(res, 200, isPublished ? "Quiz published" : "Quiz unpublished", quiz);
};
