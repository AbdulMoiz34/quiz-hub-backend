import bcrypt from "bcryptjs";
import { Admin } from "../../models/admin.model.js";
import { ADMIN_COOKIE, adminCookieOptions } from "../../config/cookies.js";
import { generateAdminJwt } from "../../utils/generateJwt.js";
import { errorResponse, successResponse } from "../../utils/responseHandler.js";

export const adminLogin = (config) => async (req, res) => {
  const admin = await Admin.findOne({ email: req.body.email })
    .select("+passwordHash +sessionVersion");

  const valid = admin && await bcrypt.compare(req.body.password, admin.passwordHash);
  if (!valid) return errorResponse(res, 401, "Invalid email or password");

  res.cookie(ADMIN_COOKIE, generateAdminJwt(admin, config.jwtSecret), adminCookieOptions(config));
  return successResponse(res, 200, "Logged in successfully", {
    id: String(admin._id), email: admin.email,
  });
};

export const adminMe = (req, res) => {
  res.set("Cache-Control", "no-store");
  return successResponse(res, 200, "Admin profile", {
    id: String(req.admin._id), email: req.admin.email,
  });
};

export const adminLogout = (config) => async (req, res) => {
  // Revoke all existing sessions for this single-admin account.
  await Admin.updateOne({ _id: req.admin._id }, { $inc: { sessionVersion: 1 } });
  const { maxAge, ...options } = adminCookieOptions(config);
  res.clearCookie(ADMIN_COOKIE, options);
  return successResponse(res, 200, "Logged out successfully");
};
