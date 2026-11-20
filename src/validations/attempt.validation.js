import Joi from "joi";

export const startAttemptSchema = Joi.object({
  quizId: Joi.string().hex().length(24).required(),
  studentName: Joi.string().trim().min(2).max(80).required(),
  // Keep this as a string: converting to Number would destroy leading zeroes.
  rollNo: Joi.string().trim().pattern(/^[0-9]{1,25}$/).required(),
  // Generated once in the browser via crypto.randomUUID(), stored locally
  // and reused on network retries. This is NOT a student account/password.
  startKey: Joi.string().guid({ version: "uuidv4" }).required(),
});
