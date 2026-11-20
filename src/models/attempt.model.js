import mongoose from "mongoose";

const attemptSchema = new mongoose.Schema({
  quiz: { type: mongoose.Schema.Types.ObjectId, ref: "Quiz", required: true },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: "Slot", required: true },
  studentName: { type: String, required: true, trim: true },
  rollNo: { type: String, required: true, match: /^[0-9]{1,25}$/ },
  startKeyHash: { type: String, required: true, select: false },
  status: { type: String, enum: ["started", "submitted", "terminated"], default: "started" },
  startedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// One attempt per roll number for the same quiz, even across different slots.
// The string roll number preserves leading zeros (e.g., "00123").
attemptSchema.index({ quiz: 1, rollNo: 1 }, { unique: true });
attemptSchema.index({ slot: 1, status: 1 });

export const Attempt = mongoose.model("Attempt", attemptSchema);
