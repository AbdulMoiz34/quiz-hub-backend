import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { Admin } from "../models/admin.model.js";
import { Attempt } from "../models/attempt.model.js";
import { ADMIN_COOKIE, ATTEMPT_COOKIE } from "../config/cookies.js";
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

// The student does not log in. This signed cookie represents a single attempt.
export function attemptAuth(jwtSecret) {
  return async (req, res, next) => {
    const token = req.cookies?.[ATTEMPT_COOKIE];
    if (!token) return errorResponse(res, 401, "Exam session missing");

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret, {
        algorithms: ["HS256"],
        issuer: "quiz-hub",
        audience: "quiz-hub-student-attempt",
      });
    } catch {
      return errorResponse(res, 401, "Exam session expired or invalid");
    }
    if (!mongoose.isObjectIdOrHexString(payload?.sub)) {
      return errorResponse(res, 401, "Exam session invalid");
    }

    try {
      const attempt = await Attempt.findById(payload.sub).lean();
      if (!attempt) return errorResponse(res, 401, "Exam session not found");
      req.attempt = attempt;
      next();
    } catch (error) {
      next(error);
    }
  };
}
