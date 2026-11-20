import jwt from "jsonwebtoken";
import { Admin } from "./admin.model.js";

export const ADMIN_COOKIE = "quiz_hub_admin";
const SESSION_HOURS = 12;

export function adminCookieOptions(config) {
  return {
    httpOnly: true,
    secure: config.nodeEnv === "production",
    sameSite: config.cookieSameSite,
    path: "/api/v1",
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
  };
}

export function signAdminToken(admin, jwtSecret) {
  return jwt.sign(
    { version: admin.sessionVersion },
    jwtSecret,
    {
      subject: String(admin._id),
      expiresIn: `${SESSION_HOURS}h`,
      algorithm: "HS256",
      issuer: "quiz-hub",
      audience: "quiz-hub-admin",
    }
  );
}

export function requireAdmin(jwtSecret) {
  return async (req, res, next) => {
    const token = req.cookies?.[ADMIN_COOKIE];
    if (!token) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
        issuer: "quiz-hub",
        audience: "quiz-hub-admin",
      });
    } catch {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (typeof payload !== "object" || !payload.sub || !Number.isInteger(payload.version)) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      const admin = await Admin.findById(payload.sub).select("+sessionVersion");
      if (!admin || admin.sessionVersion !== payload.version) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
      }
      req.admin = admin;
      next();
    } catch (error) {
      next(error);
    }
  };
}
