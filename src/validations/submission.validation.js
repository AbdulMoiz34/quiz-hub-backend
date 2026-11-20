import Joi from "joi";

// These fields are candidate-entered data, never trusted as scoring evidence.
// No client testResults, scores, correct answers or admin-only metadata.
const answerSchema = Joi.object({
  questionId: Joi.string().hex().length(24).required(),
  answer: Joi.string().allow("").max(12_000).required(),
  timeSpent: Joi.number().integer().min(0).max(21_600).default(0),
  timedOut: Joi.boolean().default(false),
});

const answers = Joi.array()
  .items(answerSchema)
  .max(250)
  .unique("questionId")
  .required();

export const draftSchema = Joi.object({
  version: Joi.number().integer().min(1).max(1_000_000).required(),
  answers,
});

export const submissionSchema = Joi.object({
  version: Joi.number().integer().min(1).max(1_000_000).required(),
  answers,
  reason: Joi.string().valid("student", "time_ended", "violation_limit").default("student"),
});
