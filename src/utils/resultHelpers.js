import mongoose from "mongoose";

export const RESULTS_FIELDS =
  "quiz fullName email phone studentName rollNo violationCount maxViolations status startedAt expiresAt submittedAt submitReason score maxScore objectiveScore gradingStatus pendingReviewCount answeredCount unansweredCount";

export function buildResultFilter({ quizId, status, gradingStatus, email, cursor }) {
  const filter = { quiz: new mongoose.Types.ObjectId(quizId) };
  if (status) filter.status = status;
  if (gradingStatus) filter.gradingStatus = gradingStatus;
  if (email) filter.email = email.trim().toLowerCase();
  if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  return filter;
}

export function resultSummary(row) {
  return {
    id: String(row._id),
    quizId: String(row.quiz),
    fullName: row.fullName || row.studentName || "",
    email: row.email || "",
    phone: row.phone || "",
    violationCount: row.violationCount || 0,
    maxViolations: row.maxViolations ?? null,
    status: row.status,
    expired: row.status === "started" && new Date(row.expiresAt) <= new Date(),
    startedAt: row.startedAt,
    submittedAt: row.submittedAt || null,
    score: row.score ?? 0,
    maxScore: row.maxScore ?? 0,
    gradingStatus: row.gradingStatus || "ungraded",
    pendingReviewCount: row.pendingReviewCount ?? 0,
    answeredCount: row.answeredCount ?? 0,
    unansweredCount: row.unansweredCount ?? 0,
  };
}

// Spreadsheet exports must not interpret untrusted candidate text as formulas.
export function csvCell(value) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export const CSV_HEADERS = [
  "Attempt ID", "Full Name", "Email", "Phone", "Violations",
  "Status", "Started At", "Submitted At", "Score", "Max Score",
  "Grading Status", "Pending Review", "Answered", "Unanswered",
];

function csvDate(value) {
  return value ? new Date(value).toISOString() : "";
}

export function csvRow(row) {
  return [
    row._id, row.fullName || row.studentName, row.email, row.phone,
    row.violationCount || 0, row.status,
    csvDate(row.startedAt), csvDate(row.submittedAt),
    row.score ?? 0, row.maxScore ?? 0, row.gradingStatus || "ungraded",
    row.pendingReviewCount ?? 0, row.answeredCount ?? 0, row.unansweredCount ?? 0,
  ].map(csvCell).join(",") + "\r\n";
}
