import "dotenv/config";
import Joi from "joi";

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  HOST: Joi.string().ip({ version: ["ipv4", "ipv6"] }).default("127.0.0.1"),
  PORT: Joi.number().integer().min(1).max(65535).default(5000),
  MONGODB_URI: Joi.string().custom((uri, helpers) => (uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://")) ? uri : helpers.error("string.uri")).required(),
  CORS_ORIGINS: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  COOKIE_SAME_SITE: Joi.string().valid("lax", "strict", "none").default("lax"),
}).unknown(true);

export function loadConfig(source = process.env) {
  const { value, error } = envSchema.validate(source, { abortEarly: false });
  if (error) {
    const fields = error.details.map(({ path }) => path.join(".")).join(", ");
    throw new Error("Invalid environment configuration: " + fields);
  }

  if (value.JWT_SECRET.startsWith("REPLACE_") || value.JWT_SECRET.startsWith("GENERATE_")) {
    throw new Error("JWT_SECRET must be generated securely, not left as a placeholder");
  }

  const allowedOrigins = [...new Set(value.CORS_ORIGINS.split(",").map((s) => s.trim()))];
  if (allowedOrigins.some((origin) => !origin || origin === "*")) {
    throw new Error("CORS_ORIGINS must contain explicit origins, not '*' or empty entries");
  }

  for (const origin of allowedOrigins) {
    let url;
    try { url = new URL(origin); }
    catch { throw new Error("CORS_ORIGINS must contain valid http(s) origins"); }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain origins only (no paths or trailing slashes)");
    }
    if (value.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("Production CORS_ORIGINS must use https");
    }
  }
  if (value.COOKIE_SAME_SITE === "none" && value.NODE_ENV !== "production") {
    throw new Error("COOKIE_SAME_SITE=none requires production HTTPS");
  }

  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    mongoUri: value.MONGODB_URI,
    allowedOrigins,
    jwtSecret: value.JWT_SECRET,
    cookieSameSite: value.COOKIE_SAME_SITE,
  };
}
