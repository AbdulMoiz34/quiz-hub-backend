import { Router } from "express";
import authRoutes from "./auth.routes.js";
import quizRoutes from "./quiz.routes.js";
import slotRoutes from "./slot.routes.js";
import gradingRoutes from "./grading.routes.js";

export default function adminRoutes(config) {
  const router = Router();
  router.use("/auth", authRoutes(config));
  router.use("/quizzes", quizRoutes(config));
  router.use("/slots", slotRoutes(config));
  router.use("/attempts", gradingRoutes(config));
  return router;
}
