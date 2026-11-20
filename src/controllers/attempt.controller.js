import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { Quiz } from "../models/quiz.model.js";
import { Slot } from "../models/slot.model.js";
import { Attempt } from "../models/attempt.model.js";
import { ATTEMPT_COOKIE, attemptCookieOptions } from "../config/cookies.js";
import { generateAttemptJwt } from "../utils/generateJwt.js";
import { studentQuestions } from "../utils/studentQuestions.js";
import { errorResponse, successResponse } from "../utils/responseHandler.js";

function publicAttempt(attempt) {
  return {
    id: String(attempt._id),
    quizId: String(attempt.quiz),
    slotId: String(attempt.slot),
    studentName: attempt.studentName,
    rollNo: attempt.rollNo,
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

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export const startAttempt = (config) => async (req, res) => {
  const { quizId, studentName, rollNo, startKey } = req.body;
  const startKeyHash = createHash("sha256").update(startKey).digest("hex");

  // Same request may be retried after a network failure. Only the browser that
  // generated the same secret startKey can recover this existing attempt.
  const existing = await Attempt.findOne({ quiz: quizId, rollNo })
    .select("+startKeyHash");
  if (existing) {
    if (existing.startKeyHash !== startKeyHash) {
      return errorResponse(res, 409, "This roll number has already started this quiz");
    }
    return issueSession(res, config, existing);
  }

  const quiz = await Quiz.findOne({ _id: quizId, isPublished: true })
    .select("durationMinutes");
  if (!quiz) return errorResponse(res, 404, "Quiz is not available");

  const now = new Date();
  const slot = await Slot.findOne({
    quiz: quizId, isActive: true,
    startsAt: { $lte: now }, endsAt: { $gt: now },
  }).select("_id endsAt capacity").lean();

  if (!slot) return errorResponse(res, 409, "No active exam slot is available");

  const expiresAt = new Date(Math.min(
    slot.endsAt.getTime(),
    now.getTime() + quiz.durationMinutes * 60_000
  ));

  let attempt;
  try {
    // The slot capacity reservation and attempt creation commit together.
    // A unique {quiz, rollNo} index prevents simultaneous duplicate starts.
    attempt = await mongoose.connection.transaction(async (session) => {
      const admitted = await Slot.findOneAndUpdate(
        {
          _id: slot._id, quiz: quizId, isActive: true,
          startsAt: { $lte: new Date() }, endsAt: { $gt: new Date() },
          $expr: { $lt: [{ $ifNull: ["$admittedCount", 0] }, "$capacity"] },
        },
        { $inc: { admittedCount: 1 } },
        { session, new: true }
      );
      if (!admitted) throw httpError(409, "Exam slot is full or closed");

      const [created] = await Attempt.create([{
        quiz: quizId,
        slot: slot._id,
        studentName,
        rollNo,
        startKeyHash,
        startedAt: now,
        expiresAt,
      }], { session });
      return created;
    });
  } catch (error) {
    // A concurrent request may have won the unique index first. Allow retry
    // only if its saved startKey matches this browser's startKey.
    if (error.code === 11000) {
      const winner = await Attempt.findOne({ quiz: quizId, rollNo })
        .select("+startKeyHash");
      if (winner?.startKeyHash === startKeyHash) return issueSession(res, config, winner);
      return errorResponse(res, 409, "This roll number has already started this quiz");
    }
    throw error;
  }

  return issueSession(res, config, attempt);
};

export const currentAttempt = async (req, res) => {
  const attempt = publicAttempt(req.attempt);
  if (attempt.status !== "started") {
    res.set("Cache-Control", "no-store");
    return successResponse(res, 200, "Exam attempt is not active", {
      attempt, quiz: null, questions: [],
    });
  }

  const quiz = await Quiz.findById(req.attempt.quiz)
    .select("title durationMinutes questionTimeSeconds maxViolations randomizeQuestions randomizeOptions questions")
    .lean();

  if (!quiz) return errorResponse(res, 404, "Quiz not found");

  // No correctAnswer, no coding test cases, no hidden admin data.
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Current exam loaded", {
    attempt,
    quiz: {
      id: String(quiz._id),
      title: quiz.title,
      durationMinutes: quiz.durationMinutes,
      questionTimeSeconds: quiz.questionTimeSeconds,
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
