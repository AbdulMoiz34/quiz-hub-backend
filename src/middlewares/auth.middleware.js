import jwt from "jsonwebtoken";
import { Admin } from "../models/admin.model.js";
import { ADMIN_COOKIE } from "../config/cookies.js";
import { errorResponse } from "../utils/responseHandler.js";

export function adminAuth(jwtSecret) {
  return async (req, res, next) => {
    const token = req.cookies?.[ADMIN_COOKIE];
    if (!token) return errorResponse(res, 401, "Unauthorized");

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
        issuer: "quiz-hub",
        audience: "quiz-hub-admin",
      });
    } catch {
      return errorResponse(res, 401, "Unauthorized");
    }

    if (!payload?.sub || !Number.isInteger(payload.version)) {
      return errorResponse(res, 401, "Unauthorized");
    }

    try {
      const admin = await Admin.findById(payload.sub).select("+sessionVersion");
      if (!admin || admin.sessionVersion !== payload.version) {
        return errorResponse(res, 401, "Unauthorized");
      }
      req.admin = admin;
      next();
    } catch (error) {
      next(error);
    }
  };
}
