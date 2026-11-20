import Joi from "joi";

export const startAttemptSchema = Joi.object({
  quizId: Joi.string().hex().length(24).required(),
  fullName: Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().trim().lowercase().email().max(254).required(),
  phone: Joi.string().trim().replace(/[\s()-]/g, "")
    .pattern(/^\+?[0-9]{7,15}$/).required(),
  // Retried POSTs reuse this UUID so a lost response never creates a second exam.
  startKey: Joi.string().guid({ version: "uuidv4" }).required(),
});
