import Joi from "joi";

export const manualGradeSchema = Joi.object({
  questionId: Joi.string().hex().length(24).required(),
  pointsAwarded: Joi.number().min(0).max(100).precision(2).required(),
});
