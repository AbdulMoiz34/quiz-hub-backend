import Joi from "joi";

const answerSchema = Joi.object({
  questionId: Joi.string().hex().length(24).required(),
  answer: Joi.string().allow("").max(12_000).required(),
});

const answers = Joi.array().items(answerSchema)
  .max(250).unique("questionId").required();

export const draftSchema = Joi.object({
  version: Joi.number().integer().min(1).max(1_000_000).required(),
  answers,
});

export const submissionSchema = Joi.object({
  version: Joi.number().integer().min(1).max(1_000_000).required(),
  answers,
  // Only the server may declare timer expiry or a violation termination.
  reason: Joi.string().valid("student").default("student"),
});
