import { createHash } from "node:crypto";
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

// A random starting seat distributes simultaneous candidates across the
// available seats. A unique database index guarantees no seat is assigned twice.
// No shared Slot document update or multi-document transaction is needed.
export const startAttempt = (config) => async (req, res) => {
  const { quizId, studentName, rollNo, startKey } = req.body;
  const startKeyHash = createHash("sha256").update(startKey).digest("hex");

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

  // Fail closed if this slot already contains attempts from the old counter
  // implementation. Those attempts lack seatNumber and must be migrated first.
  if (await Attempt.exists({ slot: slot._id, seatNumber: { $exists: false } })) {
    return errorResponse(res, 409, "This slot has legacy attempts; contact admin");
  }

  // Hash-based starting position minimizes simultaneous seat collisions.
  // Linear probing eventually checks all seats, so no free seat is skipped.
  const firstSeat = Number.parseInt(startKeyHash.slice(0, 8), 16) % slot.capacity;

  for (let offset = 0; offset < slot.capacity; offset += 1) {
    if (Date.now() >= slot.endsAt.getTime()) {
      return errorResponse(res, 409, "Exam slot has closed");
    }

    const seatNumber = ((firstSeat + offset) % slot.capacity) + 1;
    const startedAt = new Date();
    const expiresAt = new Date(Math.min(
      slot.endsAt.getTime(),
      startedAt.getTime() + quiz.durationMinutes * 60_000
    ));
    try {
      // Single-document insert is atomic. Unique indexes on {quiz,rollNo}
      // and {slot,seatNumber} enforce both constraints during concurrency.
      const attempt = await Attempt.create({
        quiz: quizId,
        slot: slot._id,
        seatNumber,
        studentName,
        rollNo,
        startKeyHash,
        startedAt,
        expiresAt,
      });
      return issueSession(res, config, attempt);
    } catch (error) {
      if (error.code !== 11000) throw error;

      // A seat collision is expected when many students start together;
      // try the next seat, without modifying the shared Slot document.
      if (error.keyPattern?.seatNumber) continue;

      // The roll-number unique index may have been claimed concurrently.
      const winner = await Attempt.findOne({ quiz: quizId, rollNo })
        .select("+startKeyHash");
      if (winner) {
        if (winner.startKeyHash === startKeyHash) {
          return issueSession(res, config, winner);
        }
        return errorResponse(res, 409, "This roll number has already started this quiz");
      }

      // If the duplicate came from the seat index but keyPattern was absent,
      // try the next candidate instead.
    }
  }

  return errorResponse(res, 409, "Exam slot is full");
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
