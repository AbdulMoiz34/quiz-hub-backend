import { Router } from "express";
import authRoutes from "./auth.routes.js";
import quizRoutes from "./quiz.routes.js";
import gradingRoutes from "./grading.routes.js";
import resultsRoutes from "./results.routes.js";

export default function adminRoutes(config) {
  const router = Router();
  router.use("/auth", authRoutes(config));
  router.use("/quizzes", quizRoutes(config));
  router.use("/attempts", gradingRoutes(config));
  router.use("/results", resultsRoutes(config));
  return router;
}
