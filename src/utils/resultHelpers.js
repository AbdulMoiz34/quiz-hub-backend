import mongoose from "mongoose";

export const RESULTS_FIELDS =
  "quiz slot studentName rollNo status startedAt expiresAt submittedAt submitReason score maxScore objectiveScore gradingStatus pendingReviewCount answeredCount unansweredCount";

export function buildResultFilter({ quizId, slotId, status, gradingStatus, rollNo, cursor }) {
  const filter = { quiz: new mongoose.Types.ObjectId(quizId) };
  if (slotId) filter.slot = new mongoose.Types.ObjectId(slotId);
  if (status) filter.status = status;
  if (gradingStatus) filter.gradingStatus = gradingStatus;
  if (rollNo) filter.rollNo = rollNo;
  if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  return filter;
}

// Raw attempt documents and answer keys must not be sent in list responses.
export function resultSummary(row) {
  return {
    id: String(row._id),
    quizId: String(row.quiz),
    slotId: String(row.slot),
    studentName: row.studentName,
    rollNo: row.rollNo,
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

// Prevent Excel/Sheets formula execution when exporting untrusted student names.
export function csvCell(value) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export const CSV_HEADERS = [
  "Attempt ID", "Roll Number", "Student Name", "Slot ID",
  "Status", "Started At", "Submitted At", "Score", "Max Score",
  "Grading Status", "Pending Review", "Answered", "Unanswered",
];

function csvDate(value) {
  return value ? new Date(value).toISOString() : "";
}

export function csvRow(row) {
  return [
    row._id, row.rollNo, row.studentName, row.slot, row.status,
    csvDate(row.startedAt), csvDate(row.submittedAt),
    row.score ?? 0, row.maxScore ?? 0, row.gradingStatus || "ungraded",
    row.pendingReviewCount ?? 0, row.answeredCount ?? 0, row.unansweredCount ?? 0,
  ].map(csvCell).join(",") + "\r\n";
}
