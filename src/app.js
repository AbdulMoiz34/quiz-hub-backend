import express from "express";
import cors from "cors";
import helmet from "helmet";
import { isDatabaseReady } from "./config/db.js";
import { HttpError, errorHandler, notFound } from "./middleware/errorHandler.js";
import { createHealthRouter } from "./routes/health.routes.js";

export function createApp({ allowedOrigins, isDbReady = isDatabaseReady }) {
  if (!Array.isArray(allowedOrigins) || allowedOrigins.length === 0) {
    throw new Error("At least one allowed CORS origin is required");
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      // A request without an Origin is not a CORS request. CORS is not authentication.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new HttpError(403, "Origin not allowed"));
    },
  }));
  app.use(express.json({ limit: "1mb" }));

  app.use("/api/v1", createHealthRouter({ isDbReady }));

  // Feature modules will be mounted here as their PRs are reviewed.
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
