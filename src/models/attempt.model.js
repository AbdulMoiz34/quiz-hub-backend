import mongoose from "mongoose";

const answerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  answer: { type: String, default: "" },
  timeSpent: { type: Number, default: 0, min: 0 },
  timedOut: { type: Boolean, default: false },
}, { _id: false });

const attemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", required: true },
  seatNumber: { type: Number, min: 1 },
  studentName: { type: String, required: true, trim: true },
  rollNo: { type: String, required: true, match: /^[0-9]{1,25}$/ },
  startKeyHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["started", "submitted", "terminated"], default: "started" },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },

  answers: { type: [answerSchema], default: [] },
  draftVersion: { type: Number, default: 0, min: 0 },
  lastSavedAt: Date,
  submittedAt: Date,
  submitReason: { type: String, enum: ["student", "time_ended", "violation_limit"] },
  answeredCount: { type: Number, default: 0 },
  unansweredCount: { type: Number, default: 0 },

  // Same document as the final answers: no separate Result/Grade collection.
  score: { type: Number, default: 0, min: 0 },
  maxScore: { type: Number, default: 0, min: 0 },
  objectiveScore: { type: Number, default: 0, min: 0 },
  gradingStatus: { type: String, enum: ["ungraded", "pending_review", "graded"], default: "ungraded" },
  pendingReviewCount: { type: Number, default: 0, min: 0 },
  manualGrades: { type: Map, of: Number, default: {} },
  gradingVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

attemptSchema.index({ quiz: 1, rollNo: 1 }, { unique: true });
// Legacy attempts without seatNumber are excluded until explicitly migrated.
attemptSchema.index({ slot: 1, seatNumber: 1 }, {
  unique: true,
  partialFilterExpression: { seatNumber: { $type: "number" } },
});
attemptSchema.index({ slot: 1, status: 1 });
// Admin results pagination reads a small page in immutable creation order.
attemptSchema.index({ quiz: 1, _id: -1 });
attemptSchema.index({ quiz: 1, slot: 1, _id: -1 });
attemptSchema.index({ status: 1, expiresAt: 1 });

export const Attempt = mongoose.model("Attempt", attemptSchema);
