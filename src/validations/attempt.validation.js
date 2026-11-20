import Joi from "joi";

export const startAttemptSchema = Joi.object({
  quizId: Joi.string().hex().length(24).required(),
  studentName: Joi.string().trim().min(2).max(80).required(),
  email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(254).required(),
  // Pakistani mobile numbers: exactly 11 digits, starting with 03.
  phone: Joi.string().pattern(/^03[0-9]{9}$/).length(11).required().messages({
    "string.pattern.base": "Phone must be 11 digits starting with 03 (e.g. 03111111222)",
    "string.length": "Phone must contain exactly 11 digits",
  }),
  // Browser creates once and preserves for idempotent start retries.
  startKey: Joi.string().guid({ version: "uuidv4" }).required(),
});

export const violationSchema = Joi.object({
  eventId: Joi.string().guid({ version: "uuidv4" }).required(),
  type: Joi.string().valid("tab_hidden", "window_blur", "fullscreen_exit").required(),
});
