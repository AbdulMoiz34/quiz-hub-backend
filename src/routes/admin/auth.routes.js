import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { adminAuth } from "../../middlewares/auth.middleware.js";
import { validateReq } from "../../middlewares/validateReq.middleware.js";
import { adminLoginSchema } from "../../validations/auth.validation.js";
import { adminLogin, adminLogout, adminMe } from "../../controllers/auth/admin.controller.js";

export default function authRoutes(config) {
  const router = Router();
  const requireAdmin = adminAuth(config.jwtSecret);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Try again later." },
  });

  router.post("/login", loginLimiter, validateReq(adminLoginSchema), adminLogin(config));
  router.get("/me", requireAdmin, adminMe);
  router.post("/logout", requireAdmin, adminLogout(config));

  return router;
}
