import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { loadConfig } from "./config/env.js";
import { isDatabaseReady } from "./config/db.js";
import adminRoutes from "./routes/admin/index.js";
import studentRoutes from "./routes/student/index.js";
import { trustedOrigin } from "./middlewares/origin.middleware.js";
import { errorHandler } from "./middlewares/error.middleware.js";
import { errorResponse } from "./utils/responseHandler.js";

export function createApp(config = loadConfig()) {
  const app = express();
  app.disable("x-powered-by");
  if (config.nodeEnv === "production") app.set("trust proxy", 1);

  app.use(helmet());
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.includes(origin)) return callback(null, true);
      const error = new Error("Origin not allowed");
      error.statusCode = 403;
      callback(error);
    },
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/v1/health", (_, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, status: "ok" });
  });
  app.get("/api/v1/ready", (_, res) => {
    res.set("Cache-Control", "no-store");
    const ready = (config.isDbReady || isDatabaseReady)();
    res.status(ready ? 200 : 503).json({
      success: ready,
      status: ready ? "ready" : "not_ready",
    });
  });

  app.use("/api/v1/admin", trustedOrigin(config.allowedOrigins), adminRoutes(config));
  app.use("/api/v1/student", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  }, trustedOrigin(config.allowedOrigins), studentRoutes(config));
  app.use((_, res) => errorResponse(res, 404, "Route not found"));
  app.use(errorHandler);
  return app;
}
