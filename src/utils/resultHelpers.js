import mongoose from "mongoose";

export const RESULTS_FIELDS =
  "quiz studentName email phone status startedAt expiresAt submittedAt submitReason violationCount score maxScore objectiveScore gradingStatus pendingReviewCount answeredCount unansweredCount";

export function buildResultFilter({ quizId, status, gradingStatus, email, cursor }) {
  const filter = { quiz: new mongoose.Types.ObjectId(quizId) };
  if (status) filter.status = status;
  if (gradingStatus) filter.gradingStatus = gradingStatus;
  if (email) filter.email = email;
  if (cursor) filter._id = { $lt: new mongoose.Types.ObjectId(cursor) };
  return filter;
}

// Only finalized and fully graded attempts have a meaningful result.
// The score is assigned by the backend, never calculated from client answers.
export function resultPercentage({ status, gradingStatus, score, maxScore }) {
  if (status !== "submitted" || gradingStatus === "pending_review") return null;
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) return null;
  return Math.round((score / maxScore) * 100);
}

export function resultSummary(row) {
  return {
    id: String(row._id),
    quizId: String(row.quiz),
    studentName: row.studentName,
    email: row.email || null,
    phone: row.phone || null,
    status: row.status,
    expired: row.status === "started" && new Date(row.expiresAt) <= new Date(),
    startedAt: row.startedAt,
    submittedAt: row.submittedAt || null,
    score: row.score ?? 0,
    maxScore: row.maxScore ?? 0,
    percentage: resultPercentage(row),
    violationCount: row.violationCount ?? 0,
    gradingStatus: row.gradingStatus || "ungraded",
    pendingReviewCount: row.pendingReviewCount ?? 0,
    answeredCount: row.answeredCount ?? 0,
    unansweredCount: row.unansweredCount ?? 0,
  };
}

// Prevent Excel/Sheets formula execution when exporting untrusted student fields.
export function csvCell(value) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  if (/^\s*[=+\-@]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export const CSV_HEADERS = [
  "Full Name", "Email", "Phone Number", "Status",
  "Started At", "Submitted At", "Score", "Max Score", "Percentage",
];

// Always display Pakistan local time, regardless of the EC2 server's timezone.
const pakistanDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Karachi",
  month: "2-digit", day: "2-digit", year: "numeric",
  hour: "2-digit", minute: "2-digit", hour12: true,
});

export function csvDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(pakistanDateFormatter.formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, part.value]));
  return `${parts.month}/${parts.day}/${parts.year} ${parts.hour}:${parts.minute}${parts.dayPeriod}`;
}

export function csvRow(row) {
  const completed = row.status === "submitted";
  const percentage = resultPercentage(row);
  return [
    row.studentName, row.email, row.phone, row.status,
    csvDate(row.startedAt), completed ? csvDate(row.submittedAt) : "",
    completed ? row.score ?? 0 : "",
    completed ? row.maxScore ?? 0 : "",
    percentage === null ? "" : `${percentage}%`,
  ].map(csvCell).join(",") + "\r\n";
}
