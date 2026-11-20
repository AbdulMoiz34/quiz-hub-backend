import Joi from "joi";

const questionSchema = Joi.object({
  type: Joi.string().valid("mcq", "true_false", "short_text", "coding").default("mcq"),
  prompt: Joi.string().trim().min(1).max(3000).required(),
  code: Joi.string().allow("").default(""),
  options: Joi.array().items(Joi.string().trim().min(1).max(1000)).max(8).default([]),
  correctAnswer: Joi.string().trim().allow("").default(""),
  points: Joi.number().integer().min(1).max(100).default(1),
  starterCode: Joi.string().allow("").default(""),
  language: Joi.string().valid("javascript").default("javascript"),
  testCases: Joi.array().items(Joi.object({
    input: Joi.any().required(),
    expected: Joi.any().required(),
    description: Joi.string().allow("").default(""),
  }).unknown(false)).max(20).default([]),
}).custom((q, helpers) => {
  if (q.type === "mcq" || q.type === "true_false") {
    const choices = q.type === "true_false" ? ["True", "False"] : q.options;
    if (choices.length < 2 || new Set(choices).size !== choices.length ||
        !choices.includes(q.correctAnswer)) {
      return helpers.message("Objective questions require distinct options and a correct answer from those options");
    }
    if (q.type === "true_false") q.options = ["True", "False"];
  }
  if (q.type === "coding" && (!q.starterCode.trim() || q.testCases.length === 0)) {
    return helpers.message("Coding questions need starterCode and testCases");
  }
  return q;
});

export const quizSchema = Joi.object({
  title: Joi.string().trim().min(2).max(150).required(),
  description: Joi.string().trim().allow("").max(3000).default(""),
  durationMinutes: Joi.number().integer().min(1).max(300).default(45),
  maxViolations: Joi.number().integer().min(1).max(10).default(3),
  randomizeQuestions: Joi.boolean().default(false),
  randomizeOptions: Joi.boolean().default(false),
  showScoreToStudent: Joi.boolean().default(false),
  questions: Joi.array().items(questionSchema).min(1).max(250).required(),
});

export const quizDetailsSchema = Joi.object({
  title: Joi.string().trim().min(2).max(150),
  description: Joi.string().trim().allow("").max(3000),
}).min(1);

export const publishSchema = Joi.object({
  isPublished: Joi.boolean().required(),
});
