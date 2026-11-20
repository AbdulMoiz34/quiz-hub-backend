import Joi from "joi";

const quizId = Joi.string().hex().length(24).required();
const optionalId = Joi.string().hex().length(24);
const common = {
  quizId,
  slotId: optionalId,
  status: Joi.string().valid("started", "submitted", "terminated"),
  gradingStatus: Joi.string().valid("ungraded", "pending_review", "graded"),
  rollNo: Joi.string().pattern(/^[0-9]{1,25}$/),
};

// Search is exact-match on numeric roll numbers; no unbounded regex scans.
export const listResultsSchema = Joi.object({
  ...common,
  limit: Joi.number().integer().min(1).max(100).default(25),
  cursor: optionalId,
});

export const exportResultsSchema = Joi.object(common);
export const resultsStatsSchema = Joi.object({
  quizId,
  slotId: optionalId,
});
