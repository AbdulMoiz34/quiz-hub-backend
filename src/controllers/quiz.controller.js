import mongoose from "mongoose";
import { Quiz } from "../models/quiz.model.js";
import { successResponse, errorResponse } from "../utils/responseHandler.js";

// The full question bank (including answer keys) is accessible to admins only.
// Student-facing question delivery will be added with verified exam attempts.

export const createQuiz = async (req, res) => {
  const quiz = await Quiz.create({ ...req.body, questionCount: req.body.questions.length });
  return successResponse(res, 201, "Quiz created", { id: String(quiz._id) });
};

export const listQuizzes = async (_req, res) => {
  const quizzes = await Quiz.find()
    .select("title description durationMinutes questionTimeSeconds maxViolations isPublished resultsPublished createdAt questionCount")
    .sort({ createdAt: -1 })
    .lean();
  return successResponse(res, 200, "Quizzes fetched", quizzes);
};

export const getQuiz = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  const quiz = await Quiz.findById(req.params.id).lean();
  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  return successResponse(res, 200, "Quiz fetched", quiz);
};

export const updateQuiz = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  const quiz = await Quiz.findOneAndUpdate(
    { _id: req.params.id, isPublished: false },
    { $set: { ...req.body, questionCount: req.body.questions.length } },
    { new: true, runValidators: true }
  );
  if (!quiz) return errorResponse(res, 409, "Quiz not found or currently published");
  return successResponse(res, 200, "Quiz updated", { id: String(quiz._id) });
};

export const publishQuiz = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return errorResponse(res, 400, "Invalid quiz ID");
  const quiz = await Quiz.findByIdAndUpdate(
    req.params.id, { $set: { isPublished: true } }, { new: true }
  ).select("title isPublished");
  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  return successResponse(res, 200, "Quiz published", quiz);
};
