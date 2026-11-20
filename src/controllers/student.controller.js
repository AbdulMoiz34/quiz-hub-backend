import { Quiz } from "../models/quiz.model.js";
import { Slot } from "../models/slot.model.js";
import { successResponse } from "../utils/responseHandler.js";

// Public metadata only; private questions/answer keys are NEVER included.
export const availableQuizzes = async (_req, res) => {
  const now = new Date();
  const quizIds = await Slot.distinct("quiz", {
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
    $expr: { $lt: [{ $ifNull: ["$admittedCount", 0] }, "$capacity"] },
  });

  if (!quizIds.length) return successResponse(res, 200, "Available quizzes", []);

  const quizzes = await Quiz.find({ _id: { $in: quizIds }, isPublished: true })
    .select("title description durationMinutes questionCount maxViolations")
    .sort({ createdAt: -1 })
    .lean();

  return successResponse(res, 200, "Available quizzes", quizzes.map((quiz) => ({
    id: String(quiz._id),
    title: quiz.title,
    description: quiz.description,
    durationMinutes: quiz.durationMinutes,
    questionCount: quiz.questionCount,
    maxViolations: quiz.maxViolations,
  })));
};
