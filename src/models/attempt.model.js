import mongoose from "mongoose";

const answerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  answer: { type: String, default: "" },
  timeSpent: { type: Number, default: 0, min: 0 },
  timedOut: { type: Boolean, default: false },
}, { _id: false });

const attemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
  fullName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  startKeyHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["started", "submitted", "terminated"], default: "started" },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },

  violationCount: { type: Number, default: 0, min: 0 },
  maxViolations: { type: Number, required: true, min: 1, max: 10 },
  violationEventIds: { type: [String], default: [], select: false },

  answers: { type: [answerSchema], default: [] },
  draftVersion: { type: Number, default: 0, min: 0 },
  lastSavedAt: Date,
  submittedAt: Date,
  submitReason: { type: String, enum: ["student", "time_ended", "violation_limit"] },
  answeredCount: { type: Number, default: 0 },
  unansweredCount: { type: Number, default: 0 },

  // Answers, final marks and manual grading live on one Attempt document.
  score: { type: Number, default: 0, min: 0 },
  maxScore: { type: Number, default: 0, min: 0 },
  objectiveScore: { type: Number, default: 0, min: 0 },
  gradingStatus: { type: String, enum: ["ungraded", "pending_review", "graded"], default: "ungraded" },
  pendingReviewCount: { type: Number, default: 0, min: 0 },
  manualGrades: { type: Map, of: Number, default: {} },
  gradingVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

// A unique partial index permits historical roll-only attempts to remain
// readable while migration is coordinated; new records require email.
attemptSchema.index({ quiz: 1, email: 1 }, {
  unique: true,
  partialFilterExpression: { email: { $type: "string" } },
});
attemptSchema.index({ quiz: 1, _id: -1 });
attemptSchema.index({ status: 1, expiresAt: 1 });

export const Attempt = mongoose.model("Attempt", attemptSchema);
