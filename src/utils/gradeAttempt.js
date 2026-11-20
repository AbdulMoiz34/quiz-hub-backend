// Trusted scoring: use ONLY the quiz's private answer keys and server-stored
// answers. Coding testResults sent by browsers must never award marks.
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function manualGradeMap(grades = {}) {
  return grades instanceof Map ? Object.fromEntries(grades) : { ...grades };
}

export function gradeAttempt(questions, answers = [], manualGrades = {}) {
  const responses = new Map(answers.map((answer) => [
    String(answer.questionId), String(answer.answer || "").trim(),
  ]));
  const reviewed = manualGradeMap(manualGrades);

  let score = 0;
  let maxScore = 0;
  let objectiveScore = 0;
  let pendingReviewCount = 0;

  for (const question of questions) {
    const id = String(question._id);
    const marks = Number(question.points);
    const answer = responses.get(id) || "";
    maxScore += marks;

    if (question.type === "mcq" || question.type === "true_false") {
      if (answer && answer === String(question.correctAnswer).trim()) {
        score += marks;
        objectiveScore += marks;
      }
      continue;
    }

    if (question.type === "short_text" || question.type === "coding") {
      // An unanswered manual question is worth 0 without needing review.
      if (!answer) continue;

      if (!Object.hasOwn(reviewed, id)) {
        pendingReviewCount += 1;
        continue;
      }
      const awarded = Number(reviewed[id]);
      if (!Number.isFinite(awarded) || awarded < 0 || awarded > marks) {
        throw new Error("Stored manual grade is outside question marks");
      }
      score += awarded;
    }
  }

  return {
    score: round(score),
    maxScore: round(maxScore),
    objectiveScore: round(objectiveScore),
    pendingReviewCount,
    gradingStatus: pendingReviewCount ? "pending_review" : "graded",
  };
}
