import Joi from "joi";

export const startAttemptSchema = Joi.object({
  quizId: Joi.string().hex().length(24).required(),
  studentName: Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
  phone: Joi.string().trim().pattern(/^\+?[0-9][0-9\s().-]{6,24}$/).max(25).required(),
  // Browser creates once and preserves for idempotent start retries.
  startKey: Joi.string().guid({ version: "uuidv4" }).required(),
});

export const violationSchema = Joi.object({
  eventId: Joi.string().guid({ version: "uuidv4" }).required(),
  type: Joi.string().valid("tab_hidden", "window_blur", "fullscreen_exit").required(),
});
