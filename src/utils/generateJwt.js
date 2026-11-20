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

export function generateAttemptJwt(attempt, secret) {
  return jwt.sign({}, secret, {
    subject: String(attempt._id),
    issuer: "quiz-hub",
    audience: "quiz-hub-student-attempt",
    algorithm: "HS256",
    expiresIn: "6h",
  });
}
