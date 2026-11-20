import { Quiz } from "../models/quiz.model.js";
import { successResponse } from "../utils/responseHandler.js";

// Public metadata only. Published quizzes are immediately accessible at any time.
export const availableQuizzes = async (_req, res) => {
  const quizzes = await Quiz.find({ isPublished: true })
    .select("title description durationMinutes questionCount maxViolations")
    .sort({ createdAt: -1 })
    .lean();

  return successResponse(res, 200, "Published quizzes", quizzes.map((quiz) => ({
    id: String(quiz._id),
    title: quiz.title,
    description: quiz.description,
    durationMinutes: quiz.durationMinutes,
    questionCount: quiz.questionCount,
    maxViolations: quiz.maxViolations,
  })));
};
