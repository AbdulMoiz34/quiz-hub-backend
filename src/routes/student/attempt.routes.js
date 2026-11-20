import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { attemptAuth } from "../../middlewares/auth.middleware.js";
import { validateReq } from "../../middlewares/validateReq.middleware.js";
import { startAttemptSchema } from "../../validations/attempt.validation.js";
import { startAttempt, currentAttempt } from "../../controllers/attempt.controller.js";

export default function attemptRoutes(config) {
  const router = Router();

  // A class can share one school Wi-Fi IP, so the limit must not be 5/IP.
  const startLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many attempts. Please try again later." },
  });

  router.post("/start", startLimiter, validateReq(startAttemptSchema), startAttempt(config));
  router.get("/current", attemptAuth(config.jwtSecret), currentAttempt);

  return router;
}
