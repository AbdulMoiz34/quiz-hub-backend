import jwt from "jsonwebtoken";

export function generateAdminJwt(admin, secret) {
  return jwt.sign({ version: admin.sessionVersion }, secret, {
    subject: String(admin._id),
    issuer: "quiz-hub",
    audience: "quiz-hub-admin",
    algorithm: "HS256",
    expiresIn: "12h",
  });
}
