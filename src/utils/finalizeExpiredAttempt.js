import { Attempt } from "../models/attempt.model.js";
import { getQuizQuestionIds, countAnswered } from "./attemptAnswers.js";
import { gradeAttempt } from "./gradeAttempt.js";

// Called by a late /submit request or the lightweight expiration script.
// The draftVersion condition prevents scoring an older draft if a concurrent
// autosave was committed just before the deadline.
export async function finalizeExpiredAttempt(attemptId) {
  for (let attemptNo = 0; attemptNo < 5; attemptNo += 1) {
    const attempt = await Attempt.findById(attemptId);
    if (!attempt || attempt.status !== "started" || attempt.expiresAt > new Date()) {
      return attempt;
    }

    const quiz = await getQuizQuestionIds(attempt.quiz);
    if (!quiz) throw new Error("Quiz missing while finalizing attempt");

    const answeredCount = countAnswered(attempt.answers);
    const grade = gradeAttempt(quiz.questions, attempt.answers);
    const version = attempt.draftVersion || 0;
    const finished = await Attempt.findOneAndUpdate(
      {
        _id: attemptId,
        status: "started",
        expiresAt: { $lte: new Date() },
        draftVersion: version === 0 ? { $in: [null, 0] } : version,
      },
      {
        $set: {
          status: "submitted",
          submitReason: "time_ended",
          submittedAt: new Date(),
          answeredCount,
          unansweredCount: Math.max(0, quiz.questionCount - answeredCount),
          ...grade,
        },
      },
      { new: true }
    );
    if (finished) return finished;
  }
  // Never manufacture a submission receipt if the database is changing.
  throw new Error("Attempt was modified during expiration finalization");
}
