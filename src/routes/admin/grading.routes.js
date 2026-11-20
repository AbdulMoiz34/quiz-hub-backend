import { Router } from "express";
import { adminAuth } from "../../middlewares/auth.middleware.js";
import { validateReq } from "../../middlewares/validateReq.middleware.js";
import { manualGradeSchema } from "../../validations/grading.validation.js";
import { gradeManualAnswer, getAttemptForReview } from "../../controllers/grading.controller.js";
import { deleteAttempt } from "../../controllers/attemptAdmin.controller.js";

export default function gradingRoutes(config) {
  const router = Router();
  router.use(adminAuth(config.jwtSecret));

  router.get("/:id", getAttemptForReview);
  router.patch("/:id/grade", validateReq(manualGradeSchema), gradeManualAnswer);
  router.delete("/:id", deleteAttempt);
  return router;
}
