import "dotenv/config";

// Keep environment parsing in one place. Do not log secrets or MongoDB URIs.
export function loadConfig(env = process.env) {
  const allowedOrigins = (env.CORS_ORIGINS || "")
    .split(",").map((origin) => origin.trim()).filter(Boolean);

  if (!env.MONGODB_URI?.startsWith("mongodb://") &&
      !env.MONGODB_URI?.startsWith("mongodb+srv://")) {
    throw new Error("MONGODB_URI is required");
  }
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32 ||
      /^(REPLACE_|GENERATE_)/.test(env.JWT_SECRET)) {
    throw new Error("JWT_SECRET must contain a random 32+ character secret");
  }
  if (!allowedOrigins.length || allowedOrigins.includes("*")) {
    throw new Error("CORS_ORIGINS must contain explicit origins");
  }
  const nodeEnv = env.NODE_ENV || "development";
  const cookieSameSite = env.COOKIE_SAME_SITE || "lax";
  if (!["lax", "strict", "none"].includes(cookieSameSite)) {
    throw new Error("Invalid COOKIE_SAME_SITE");
  }
  if (cookieSameSite === "none" && nodeEnv !== "production") {
    throw new Error("SameSite=None requires production HTTPS");
  }

  for (const origin of allowedOrigins) {
    let url;
    try { url = new URL(origin); } catch { throw new Error("Invalid CORS origin"); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain origins only");
    }
    if (nodeEnv === "production" && url.protocol !== "https:") {
      throw new Error("Production CORS origins must use HTTPS");
    }
  }

  return {
    nodeEnv,
    port: Number(env.PORT || 5000),
    host: env.HOST || "127.0.0.1",
    mongoUri: env.MONGODB_URI,
    jwtSecret: env.JWT_SECRET,
    allowedOrigins,
    cookieSameSite,
  };
}
