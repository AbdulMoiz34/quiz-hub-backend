import { Attempt } from "../models/attempt.model.js";
import { getQuizQuestionIds, countAnswered } from "../utils/attemptAnswers.js";
import { gradeAttempt } from "../utils/gradeAttempt.js";
import { finalizeExpiredAttempt } from "../utils/finalizeExpiredAttempt.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

const response = (attempt) => ({
  attemptId: String(attempt._id),
  violationCount: attempt.violationCount || 0,
  maxViolations: attempt.maxViolations,
  status: attempt.status,
});

// Each event uses a UUID. Retries cannot increment twice; CAS ensures
// simultaneous events do not exceed the configured violation limit.
export const reportViolation = async (req, res) => {
  const { eventId } = req.body;
  const attemptId = req.attempt._id;

  for (let retry = 0; retry < 8; retry += 1) {
    const attempt = await Attempt.findById(attemptId)
      .select("+violationEventIds").lean();
    if (!attempt) return errorResponse(res, 401, "Exam session is no longer available");

    if (attempt.status !== "started") {
      return successResponse(res, 200, "Exam already finished", response(attempt));
    }
    if (new Date(attempt.expiresAt) <= new Date()) {
      const finished = await finalizeExpiredAttempt(attemptId);
      if (!finished) return errorResponse(res, 401, "Exam session is no longer available");
      return successResponse(res, 200, "Exam deadline reached", response(finished));
    }
    if (attempt.violationEventIds?.includes(eventId)) {
      return successResponse(res, 200, "Violation already recorded", response(attempt));
    }

    const count = attempt.violationCount || 0;
    const limit = attempt.maxViolations;
    if (count >= limit) return errorResponse(res, 409, "Violation limit already reached");

    const terminating = count + 1 >= limit;
    const now = new Date();
    let finish = {};
    if (terminating) {
      const quiz = await getQuizQuestionIds(attempt.quiz);
      if (!quiz) return errorResponse(res, 404, "Quiz not found");
      const answeredCount = countAnswered(attempt.answers);
      finish = {
        status: "terminated",
        submitReason: "violation_limit",
        submittedAt: now,
        answeredCount,
        unansweredCount: Math.max(0, quiz.questionCount - answeredCount),
        ...gradeAttempt(quiz.questions, attempt.answers),
      };
    }

    const updated = await Attempt.findOneAndUpdate({
      _id: attemptId,
      status: "started",
      expiresAt: { $gt: now },
      violationCount: count === 0 ? { $in: [0, null] } : count,
      draftVersion: (attempt.draftVersion || 0) === 0
        ? { $in: [0, null] } : attempt.draftVersion,
      violationEventIds: { $ne: eventId },
    }, {
      $inc: { violationCount: 1 },
      $addToSet: { violationEventIds: eventId },
      ...(terminating ? { $set: finish } : {}),
    }, { returnDocument: "after" }).select("violationCount maxViolations status");

    if (updated) {
      return successResponse(res, 200,
        terminating ? "Violation limit reached; exam terminated" : "Violation recorded",
        response(updated));
    }
    // A save, submit or competing violation won the CAS. Re-read and retry.
  }
  return errorResponse(res, 409, "Exam state changed. Retry the same violation event.");
};
