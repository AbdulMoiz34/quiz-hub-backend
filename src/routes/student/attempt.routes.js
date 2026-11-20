import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { attemptAuth } from "../../middlewares/auth.middleware.js";
import { validateReq } from "../../middlewares/validateReq.middleware.js";
import { startAttemptSchema, violationSchema } from "../../validations/attempt.validation.js";
import { draftSchema, submissionSchema } from "../../validations/submission.validation.js";
import { startAttempt, currentAttempt } from "../../controllers/attempt.controller.js";
import { saveDraft, submitAttempt } from "../../controllers/submission.controller.js";
import { reportViolation } from "../../controllers/violation.controller.js";
import { errorResponse } from "../../utils/responseHandler.js";

// Optional during transition: new student UI always sends this identifier.
// A different tab's cookie must not silently save/submit the wrong attempt.
function checkExpectedAttempt(req, res, next) {
  const expected = req.get("X-Expected-Attempt-Id");
  if (expected && expected !== String(req.attempt._id)) {
    return errorResponse(res, 409, "This browser is using a different exam session");
  }
  next();
}

export default function attemptRoutes(config) {
  const router = Router();
  const authenticate = attemptAuth(config.jwtSecret);

  // School candidates may share a single external IP.
  const startLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Please try again later." },
  });

  router.post("/start", startLimiter, validateReq(startAttemptSchema), startAttempt(config));
  router.get("/current", authenticate, currentAttempt);
  router.put("/draft", authenticate, checkExpectedAttempt, validateReq(draftSchema), saveDraft);
  router.post("/submit", authenticate, checkExpectedAttempt, validateReq(submissionSchema), submitAttempt);
  router.post("/violations", authenticate, checkExpectedAttempt, validateReq(violationSchema), reportViolation);

  return router;
}
