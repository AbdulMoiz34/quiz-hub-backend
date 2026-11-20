import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
  type: { type: String, enum: ["mcq", "true_false", "short_text", "coding"], required: true },
  prompt: { type: String, required: true, trim: true },
  code: { type: String, default: "" },
  options: { type: [String], default: [] },
  correctAnswer: { type: String, default: "" },
  points: { type: Number, required: true, min: 1 },
  timeSeconds: { type: Number, required: true, min: 10, max: 300 },
  starterCode: { type: String, default: "" },
  language: { type: String, default: "javascript" },
  testCases: { type: [mongoose.Schema.Types.Mixed], default: [] },
});

const quizSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  durationMinutes: { type: Number, required: true, min: 1, max: 300 },
  questionTimeSeconds: { type: Number, required: true, min: 10, max: 300 },
  maxViolations: { type: Number, required: true, min: 1, max: 10 },
  randomizeQuestions: { type: Boolean, default: false },
  randomizeOptions: { type: Boolean, default: false },
  showScoreToStudent: { type: Boolean, default: false },
  isPublished: { type: Boolean, default: false },
  resultsPublished: { type: Boolean, default: false },
  questions: { type: [questionSchema], required: true },
  questionCount: { type: Number, required: true, min: 1 },
}, { timestamps: true });

quizSchema.index({ isPublished: 1, createdAt: -1 });

export const Quiz = mongoose.model("Quiz", quizSchema);
