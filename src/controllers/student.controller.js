import { Quiz } from "../models/quiz.model.js";
import { Slot } from "../models/slot.model.js";
import { Attempt } from "../models/attempt.model.js";
import { successResponse } from "../utils/responseHandler.js";

// Only public quiz metadata is returned; answers and test cases stay private.
export const availableQuizzes = async (_req, res) => {
  const now = new Date();
  const slots = await Slot.find({
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
  }).select("_id quiz capacity").lean();

  // Count saved attempts instead of reading a shared, contention-prone counter.
  // There are only a few concurrent active slots in this application.
  const available = await Promise.all(slots.map(async (slot) => {
    const occupied = await Attempt.countDocuments({ slot: slot._id });
    return occupied < slot.capacity ? String(slot.quiz) : null;
  }));
  const quizIds = [...new Set(available.filter(Boolean))];

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
