import { Router } from "express";
import authRoutes from "./auth.routes.js";
import quizRoutes from "./quiz.routes.js";

export default function adminRoutes(config) {
  const router = Router();
  router.use("/auth", authRoutes(config));
  router.use("/quizzes", quizRoutes(config));
  return router;
}
