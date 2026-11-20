import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import Joi from "joi";
import { Admin } from "./admin.model.js";
import { ADMIN_COOKIE, adminCookieOptions, requireAdmin, signAdminToken } from "./admin.auth.js";

const credentialsSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(1).max(128).required(),
}).required();

export function createAdminRoutes(config) {
  const router = Router();
  const authenticate = requireAdmin(config.jwtSecret);
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { success: false, message: "Too many login attempts. Try again later." },
  });

  router.post("/login", loginLimiter, async (req, res) => {
    const { value, error } = credentialsSchema.validate(req.body, {
      abortEarly: false,
      allowUnknown: false,
    });
    if (error) return res.status(400).json({ success: false, message: "Invalid login details" });

    const admin = await Admin.findOne({ email: value.email.toLowerCase() })
      .select("+passwordHash +sessionVersion");
    const validPassword = admin && await bcrypt.compare(value.password, admin.passwordHash);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const token = signAdminToken(admin, config.jwtSecret);
    res.cookie(ADMIN_COOKIE, token, adminCookieOptions(config));
    return res.status(200).json({
      success: true,
      admin: { id: String(admin._id), email: admin.email },
    });
  });

  router.get("/me", authenticate, (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, admin: { id: String(req.admin._id), email: req.admin.email } });
  });

  router.post("/logout", authenticate, async (req, res) => {
    // Logging out invalidates every existing token for this single-admin account.
    await Admin.updateOne({ _id: req.admin._id }, { $inc: { sessionVersion: 1 } });
    const { maxAge, ...clearOptions } = adminCookieOptions(config);
    res.clearCookie(ADMIN_COOKIE, clearOptions);
    return res.json({ success: true, message: "Logged out" });
  });

  return router;
}
