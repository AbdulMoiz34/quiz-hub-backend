import { Attempt } from "../models/attempt.model.js";
import {
  getQuizQuestionIds, answersBelongToQuiz, countAnswered, sameAnswers,
} from "../utils/attemptAnswers.js";
import { gradeAttempt } from "../utils/gradeAttempt.js";
import { finalizeExpiredAttempt } from "../utils/finalizeExpiredAttempt.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

function receipt(attempt) {
  return {
    attemptId: String(attempt._id),
    status: attempt.status,
    submittedAt: attempt.submittedAt,
    submitReason: attempt.submitReason,
    answeredCount: attempt.answeredCount,
    unansweredCount: attempt.unansweredCount,
  };
}

function draftReceipt(attempt) {
  return {
    version: attempt.draftVersion,
    savedAt: attempt.lastSavedAt,
  };
}

function isExpired(attempt) {
  return new Date(attempt.expiresAt) <= new Date();
}

export const saveDraft = async (req, res) => {
  const { version, answers } = req.body;
  const attempt = req.attempt;

  if (attempt.status !== "started" || isExpired(attempt)) {
    return errorResponse(res, 409, "Exam is no longer active");
  }

  const quiz = await getQuizQuestionIds(attempt.quiz);
  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  if (!answersBelongToQuiz(answers, quiz.questionIds)) {
    return errorResponse(res, 400, "Answers contain an invalid question ID");
  }

  const saved = await Attempt.findOneAndUpdate(
    {
      _id: attempt._id,
      status: "started",
      expiresAt: { $gt: new Date() },
      draftVersion: { $lt: version },
    },
    { $set: { answers, draftVersion: version, lastSavedAt: new Date() } },
    { new: true }
  ).select("draftVersion lastSavedAt");

  if (saved) return successResponse(res, 200, "Answers saved", draftReceipt(saved));

  const latest = await Attempt.findById(attempt._id);
  if (!latest || latest.status !== "started" || isExpired(latest)) {
    return errorResponse(res, 409, "Exam is no longer active");
  }
  if (latest.draftVersion === version && sameAnswers(latest.answers, answers)) {
    return successResponse(res, 200, "Answers already saved", draftReceipt(latest));
  }

  return errorResponse(res, 409, "Outdated draft. Reload your saved answers");
};

export const submitAttempt = async (req, res) => {
  const { version, answers, reason } = req.body;
  const attempt = req.attempt;

  if (attempt.status !== "started") {
    return successResponse(res, 200, "Exam already submitted", receipt(attempt));
  }

  const quiz = await getQuizQuestionIds(attempt.quiz);
  if (!quiz) return errorResponse(res, 404, "Quiz not found");

  if (isExpired(attempt)) {
    const final = await finalizeExpiredAttempt(attempt._id);
    return successResponse(res, 200, "Deadline reached. Saved answers finalized", receipt(final));
  }

  if (!answersBelongToQuiz(answers, quiz.questionIds)) {
    return errorResponse(res, 400, "Answers contain an invalid question ID");
  }

  const now = new Date();
  const answeredCount = countAnswered(answers);
  const grade = gradeAttempt(quiz.questions, answers);
  const finished = await Attempt.findOneAndUpdate(
    {
      _id: attempt._id,
      status: "started",
      expiresAt: { $gt: now },
      draftVersion: { $lte: version },
    },
    {
      $set: {
        answers,
        draftVersion: version,
        lastSavedAt: now,
        status: "submitted",
        submitReason: reason,
        submittedAt: now,
        answeredCount,
        unansweredCount: Math.max(0, quiz.questionCount - answeredCount),
        ...grade,
      },
    },
    { new: true }
  );

  if (finished) {
    return successResponse(res, 200, "Exam submitted successfully", receipt(finished));
  }

  const latest = await Attempt.findById(attempt._id);
  if (!latest) return errorResponse(res, 404, "Exam attempt not found");
  if (latest.status !== "started") {
    return successResponse(res, 200, "Exam already submitted", receipt(latest));
  }
  if (isExpired(latest)) {
    const final = await finalizeExpiredAttempt(attempt._id);
    return successResponse(res, 200, "Deadline reached. Saved answers finalized", receipt(final));
  }
  return errorResponse(res, 409, "Outdated submission. Reload your saved answers");
};
