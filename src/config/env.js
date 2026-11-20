import "dotenv/config";
import Joi from "joi";

const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid("development", "test", "production").default("development"),
  HOST: Joi.string().ip({ version: ["ipv4", "ipv6"] }).default("127.0.0.1"),
  PORT: Joi.number().integer().min(1).max(65535).default(5000),
  MONGODB_URI: Joi.string().pattern(/^mongodb(?:\+srv)?:\/\//).required(),
  CORS_ORIGINS: Joi.string().required(),
}).unknown(true);

export function loadConfig(source = process.env) {
  const { value, error } = envSchema.validate(source, { abortEarly: false });
  if (error) {
    // Never log credentials from environment values.
    const fields = error.details.map(({ path }) => path.join(".")).join(", ");
    throw new Error("Invalid environment configuration: " + fields);
  }

  const allowedOrigins = [...new Set(value.CORS_ORIGINS.split(",").map((s) => s.trim()))];
  if (allowedOrigins.some((origin) => !origin || origin === "*")) {
    throw new Error("CORS_ORIGINS must contain explicit origins, not '*' or empty entries");
  }

  for (const origin of allowedOrigins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error("CORS_ORIGINS must contain valid http(s) origins");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
      throw new Error("CORS_ORIGINS must contain origins only (no paths or trailing slashes)");
    }
    if (value.NODE_ENV === "production" && url.protocol !== "https:") {
      throw new Error("Production CORS_ORIGINS must use https");
    }
  }

  return {
    nodeEnv: value.NODE_ENV,
    host: value.HOST,
    port: value.PORT,
    mongoUri: value.MONGODB_URI,
    allowedOrigins,
  };
}
