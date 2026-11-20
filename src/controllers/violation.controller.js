import { Attempt } from "../models/attempt.model.js";
import { Quiz } from "../models/quiz.model.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

// Client reports observable browser events, never a trusted strike count.
// A UUID eventId makes network retries idempotent. This is a deterrent, not
// proof of cheating: users can suppress client-side reports.
export const reportViolation = async (req, res) => {
  const attempt = req.attempt;
  const quiz = await Quiz.findById(attempt.quiz).select("maxViolations").lean();
  if (!quiz) return errorResponse(res, 404, "Quiz not found");

  const { eventId, type } = req.body;
  if (attempt.violations?.some((event) => event.eventId === eventId)) {
    return successResponse(res, 200, "Violation already recorded", {
      status: attempt.status, violationCount: attempt.violationCount,
      maxViolations: quiz.maxViolations,
    });
  }
  if (attempt.status !== "started" || new Date(attempt.expiresAt) <= new Date()) {
    return errorResponse(res, 409, "Exam is no longer active");
  }

  const now = new Date();
  const nextCount = { $add: [{ $ifNull: ["$violationCount", 0] }, 1] };
  const limitReached = { $gte: [nextCount, quiz.maxViolations] };

  // One atomic document operation: append event, increment count, terminate at
  // threshold. Concurrent reports cannot lose increments or exceed the limit.
  const updated = await Attempt.findOneAndUpdate(
    {
      _id: attempt._id, status: "started", expiresAt: { $gt: now },
      "violations.eventId": { $ne: eventId },
    },
    [{
      $set: {
        violations: {
          $concatArrays: [
            { $ifNull: ["$violations", []] },
            [{ eventId, type, reportedAt: now }],
          ],
        },
        violationCount: nextCount,
        status: { $cond: [limitReached, "terminated", "started"] },
        submittedAt: { $cond: [limitReached, now, "$$REMOVE"] },
        submitReason: { $cond: [limitReached, "violation_limit", "$$REMOVE"] },
      },
    }],
    { returnDocument: "after" }
  ).select("status violationCount violations");

  if (updated) {
    return successResponse(res, 200, "Violation recorded", {
      status: updated.status, violationCount: updated.violationCount,
      maxViolations: quiz.maxViolations,
    });
  }

  const latest = await Attempt.findById(attempt._id)
    .select("status violationCount violations expiresAt").lean();
  if (!latest) return errorResponse(res, 401, "Exam session no longer exists");
  if (latest.violations?.some((v) => v.eventId === eventId)) {
    return successResponse(res, 200, "Violation already recorded", {
      status: latest.status, violationCount: latest.violationCount,
      maxViolations: quiz.maxViolations,
    });
  }
  return errorResponse(res, 409, "Exam is no longer active");
};
