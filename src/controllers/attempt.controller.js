import { createHash } from "node:crypto";
import { Quiz } from "../models/quiz.model.js";
import { Attempt } from "../models/attempt.model.js";
import { ATTEMPT_COOKIE, attemptCookieOptions } from "../config/cookies.js";
import { generateAttemptJwt } from "../utils/generateJwt.js";
import { studentQuestions } from "../utils/studentQuestions.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

function publicAttempt(attempt) {
  return {
    id: String(attempt._id),
    quizId: String(attempt.quiz),
    studentName: attempt.studentName,
    email: attempt.email,
    phone: attempt.phone,
    status: attempt.status === "started" && new Date(attempt.expiresAt) <= new Date()
      ? "expired" : attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    violationCount: attempt.violationCount ?? 0,
  };
}

function issueSession(res, config, attempt) {
  res.cookie(ATTEMPT_COOKIE, generateAttemptJwt(attempt, config.jwtSecret), attemptCookieOptions(config));
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Exam attempt ready", publicAttempt(attempt));
}

// One atomic insert per candidate; unique {quiz,email} ensures one attempt per quiz,
// including across simultaneous requests from multiple tabs/devices.
export const startAttempt = (config) => async (req, res) => {
  const { quizId, studentName, email, phone, startKey } = req.body;
  const startKeyHash = createHash("sha256").update(startKey).digest("hex");

  const existing = await Attempt.findOne({ quiz: quizId, email }).select("+startKeyHash");
  if (existing) {
    if (existing.startKeyHash !== startKeyHash) {
      return errorResponse(res, 409, "This email has already attempted this quiz");
    }
    return issueSession(res, config, existing);
  }

  const quiz = await Quiz.findOne({ _id: quizId, isPublished: true })
    .select("durationMinutes");
  if (!quiz) return errorResponse(res, 404, "Quiz is not available");

  const startedAt = new Date();
  try {
    const attempt = await Attempt.create({
      quiz: quizId, studentName, email, phone, startKeyHash,
      startedAt, expiresAt: new Date(startedAt.getTime() + quiz.durationMinutes * 60_000),
    });
    return issueSession(res, config, attempt);
  } catch (error) {
    if (error.code !== 11000) throw error;
    const winner = await Attempt.findOne({ quiz: quizId, email }).select("+startKeyHash");
    if (!winner) {
      // Obsolete unique quiz+rollNo index? Run the documented DB migration.
      return errorResponse(res, 409, "Unable to reserve attempt; contact admin");
    }
    if (winner.startKeyHash === startKeyHash) return issueSession(res, config, winner);
    return errorResponse(res, 409, "This email has already attempted this quiz");
  }
};

export const currentAttempt = async (req, res) => {
  const attempt = publicAttempt(req.attempt);
  if (attempt.status !== "started") {
    res.set("Cache-Control", "no-store");
    return successResponse(res, 200, "Exam attempt is not active", {
      attempt, quiz: null, questions: [], serverNow: new Date().toISOString(),
    });
  }

  const quiz = await Quiz.findById(req.attempt.quiz)
    .select("title durationMinutes maxViolations randomizeQuestions randomizeOptions questions")
    .lean();

  if (!quiz) return errorResponse(res, 404, "Quiz not found");
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Current exam loaded", {
    serverNow: new Date().toISOString(),
    attempt,
    quiz: {
      id: String(quiz._id),
      title: quiz.title,
      durationMinutes: quiz.durationMinutes,
      maxViolations: quiz.maxViolations,
    },
    questions: studentQuestions(quiz, req.attempt._id),
    draft: {
      version: req.attempt.draftVersion || 0,
      answers: req.attempt.answers || [],
      savedAt: req.attempt.lastSavedAt || null,
    },
  });
};
