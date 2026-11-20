import mongoose from "mongoose";

const answerSchema = new mongoose.Schema({
  questionId: { type: String, required: true },
  answer: { type: String, default: "" },
}, { _id: false });

const violationSchema = new mongoose.Schema({
  eventId: { type: String, required: true },
  type: { type: String, enum: ["tab_hidden", "window_blur", "fullscreen_exit"], required: true },
  reportedAt: { type: Date, required: true },
}, { _id: false });

const attemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
  studentName: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true },
  phone: { type: String, required: true, trim: true },
  startKeyHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["started", "submitted", "terminated"], default: "started" },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },

  answers: { type: [answerSchema], default: [] },
  draftVersion: { type: Number, default: 0, min: 0 },
  lastSavedAt: Date,
  violationCount: { type: Number, default: 0, min: 0 },
  violations: { type: [violationSchema], default: [] },
  submittedAt: Date,
  submitReason: { type: String, enum: ["student", "time_ended", "violation_limit"] },
  answeredCount: { type: Number, default: 0 },
  unansweredCount: { type: Number, default: 0 },

  // Score and manual grading live on the same attempt, no extra collection.
  score: { type: Number, default: 0, min: 0 },
  maxScore: { type: Number, default: 0, min: 0 },
  objectiveScore: { type: Number, default: 0, min: 0 },
  gradingStatus: { type: String, enum: ["ungraded", "pending_review", "graded"], default: "ungraded" },
  pendingReviewCount: { type: Number, default: 0, min: 0 },
  manualGrades: { type: Map, of: Number, default: {} },
  gradingVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

// The partial index preserves read-only legacy roll-number attempts until archived/migrated.
// The obsolete quiz+rollNo index MUST be dropped before accepting new attempts.
attemptSchema.index({ quiz: 1, email: 1 }, {
  unique: true,
  partialFilterExpression: { email: { $type: "string" } },
});
attemptSchema.index({ quiz: 1, _id: -1 });
attemptSchema.index({ status: 1, expiresAt: 1 });

export const Attempt = mongoose.model("Attempt", attemptSchema);
