import { Router } from "express";
import { adminAuth } from "../../middlewares/auth.middleware.js";
import { validateReq } from "../../middlewares/validateReq.middleware.js";
import { quizSchema, publishSchema } from "../../validations/quiz.validation.js";
import {
  createQuiz, listQuizzes, getQuiz, updateQuiz, publishQuiz,
} from "../../controllers/quiz.controller.js";

export default function quizRoutes(config) {
  const router = Router();
  router.use(adminAuth(config.jwtSecret));

  router.get("/", listQuizzes);
  router.post("/", validateReq(quizSchema), createQuiz);
  router.get("/:id", getQuiz);
  router.put("/:id", validateReq(quizSchema), updateQuiz);
  router.patch("/:id/publish", validateReq(publishSchema), publishQuiz);

  return router;
}
