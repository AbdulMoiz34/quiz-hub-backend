import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";

async function start() {
  const config = loadConfig();
  await connectDatabase(config.mongoUri);
  console.info("MongoDB connected");

  const app = createApp({ allowedOrigins: config.allowedOrigins });
  const server = app.listen(config.port, config.host, () => {
    console.info("API listening on " + config.host + ":" + config.port);
  });

  let isShuttingDown = false;
  async function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.info("Received " + signal + ", closing server");

    const timeout = setTimeout(() => {
      console.error("Graceful shutdown timed out");
      process.exit(1);
    }, 10_000);
    timeout.unref();

    server.close(async (err) => {
      try {
        await disconnectDatabase();
      } catch (dbErr) {
        console.error("Database disconnect failed:", dbErr);
        process.exitCode = 1;
      }
      if (err) {
        console.error("HTTP server close failed:", err);
        process.exitCode = 1;
      }
      clearTimeout(timeout);
    });
  }

  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.once("SIGINT", () => { void shutdown("SIGINT"); });
}

start().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exitCode = 1;
});
