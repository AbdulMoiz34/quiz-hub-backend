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
    fullName: attempt.fullName,
    email: attempt.email,
    phone: attempt.phone,
    violationCount: attempt.violationCount || 0,
    maxViolations: attempt.maxViolations,
    status: attempt.status === "started" && new Date(attempt.expiresAt) <= new Date()
      ? "expired" : attempt.status,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
  };
}

function issueSession(res, config, attempt) {
  res.cookie(ATTEMPT_COOKIE, generateAttemptJwt(attempt, config.jwtSecret), attemptCookieOptions(config));
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Exam attempt ready", publicAttempt(attempt));
}

// Unique {quiz,email} index is the concurrency gate, NOT a frontend pre-check.
export const startAttempt = (config) => async (req, res) => {
  const { quizId, fullName, email, phone, startKey } = req.body;
  const startKeyHash = createHash("sha256").update(startKey).digest("hex");

  const existing = await Attempt.findOne({ quiz: quizId, email })
    .select("+startKeyHash");
  if (existing) {
    if (existing.startKeyHash !== startKeyHash) {
      return errorResponse(res, 409, "This email has already attempted this quiz. Contact the admin for a reset.");
    }
    return issueSession(res, config, existing);
  }

  const quiz = await Quiz.findOne({ _id: quizId, isPublished: true })
    .select("durationMinutes maxViolations");
  if (!quiz) return errorResponse(res, 404, "Quiz is not available");

  const startedAt = new Date();
  try {
    const attempt = await Attempt.create({
      quiz: quizId, fullName, email, phone, startKeyHash,
      startedAt,
      expiresAt: new Date(startedAt.getTime() + quiz.durationMinutes * 60_000),
      maxViolations: quiz.maxViolations,
    });
    return issueSession(res, config, attempt);
  } catch (error) {
    if (error.code !== 11000) throw error;

    // Parallel POSTs for one email must resolve to one real Attempt.
    const winner = await Attempt.findOne({ quiz: quizId, email })
      .select("+startKeyHash");
    if (winner?.startKeyHash === startKeyHash) {
      return issueSession(res, config, winner);
    }
    if (winner) {
      return errorResponse(res, 409, "This email has already attempted this quiz. Contact the admin for a reset.");
    }
    throw error; // Unexpected unique-index conflict: don't misreport success.
  }
};

export const currentAttempt = async (req, res) => {
  const attempt = publicAttempt(req.attempt);
  if (attempt.status !== "started") {
    return successResponse(res, 200, "Exam attempt is not active", {
      attempt, quiz: null, questions: [], serverNow: new Date().toISOString(),
    });
  }

  const quiz = await Quiz.findById(req.attempt.quiz)
    .select("title durationMinutes maxViolations randomizeQuestions randomizeOptions questions")
    .lean();
  if (!quiz) return errorResponse(res, 404, "Quiz not found");

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
