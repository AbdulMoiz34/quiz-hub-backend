import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config/env.js";
import { connectDB, isDatabaseReady, disconnectDB } from "./config/db.js";
import adminRoutes from "./routes/admin/index.js";
import { adminOrigin } from "./middlewares/adminOrigin.middleware.js";
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

  app.use("/api/v1/admin", adminOrigin(config.allowedOrigins), adminRoutes(config));
  app.use((_, res) => errorResponse(res, 404, "Route not found"));
  app.use(errorHandler);
  return app;
}

// One entry point. Importing createApp for tests does not start a server.
const launchedDirectly = process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (launchedDirectly) {
  const config = loadConfig();
  try {
    await connectDB(config.mongoUri);
    const server = createApp(config).listen(config.port, config.host, () => {
      console.info(`Quiz Hub API listening at ${config.host}:${config.port}`);
    });

    let closing = false;
    async function shutdown() {
      if (closing) return;
      closing = true;
      const timeout = setTimeout(() => process.exit(1), 10_000);
      timeout.unref();
      server.close(async (error) => {
        try { await disconnectDB(); } catch { process.exitCode = 1; }
        if (error) process.exitCode = 1;
        clearTimeout(timeout);
      });
    }
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    console.error("Failed to start API. Check MongoDB access and environment configuration.");
    process.exitCode = 1;
  }
}
