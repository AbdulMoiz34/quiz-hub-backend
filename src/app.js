import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { isDatabaseReady } from "./config/db.js";
import { HttpError, errorHandler, notFound } from "./middleware/errorHandler.js";
import { adminOrigin } from "./middleware/adminOrigin.js";
import { createHealthRouter } from "./routes/health.routes.js";
import { createAdminRoutes } from "./modules/admin/admin.routes.js";

export function createApp({ allowedOrigins, jwtSecret, nodeEnv = "development", cookieSameSite = "lax", isDbReady = isDatabaseReady }) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new Error("At least one allowed CORS origin is required");
  }
  if (typeof jwtSecret !== "string" || jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  const app = express();
  app.disable("x-powered-by");
  // In production the API sits behind exactly one Nginx proxy (port 5000 is private).
  if (nodeEnv === "production") app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, "Origin not allowed"));
    },
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.use("/api/v1", createHealthRouter({ isDbReady }));
  app.use("/api/v1/admin", adminOrigin(allowedOrigins));
  app.use("/api/v1/admin/auth", createAdminRoutes({ jwtSecret, nodeEnv, cookieSameSite }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
