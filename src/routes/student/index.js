import { Router } from "express";
import attemptRoutes from "./attempt.routes.js";
import { availableQuizzes } from "../../controllers/student.controller.js";

export default function studentRoutes(config) {
  const router = Router();

  router.get("/quizzes", availableQuizzes);
  router.use("/attempts", attemptRoutes(config));
  return router;
}
