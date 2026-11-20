import { createApp } from "./app.js";
import { connectDB, disconnectDB } from "./config/db.js";
import { loadConfig } from "./config/env.js";
import { Attempt } from "./models/attempt.model.js";
import { assertAttemptIndexesReady } from "./utils/attemptIndexReadiness.js";

// Single startup entry point for both "npm start" and PM2.
async function start() {
  const config = loadConfig();
  await connectDB(config.mongoUri);
  await Attempt.init();
  // Fail startup instead of advertising readiness while a legacy unique
  // roll-number/slot index rejects valid candidates at exam start.
  await assertAttemptIndexesReady(Attempt.collection);

  const server = createApp(config).listen(config.port, config.host, () => {
    console.info(`Quiz Hub API listening at ${config.host}:${config.port}`);
  });

  let closing = false;
  function shutdown() {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10_000);
    timeout.unref();
    server.close(async (error) => {
      if (error) process.exitCode = 1;
      try { await disconnectDB(); } catch { process.exitCode = 1; }
      clearTimeout(timeout);
    });
  }

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

start().catch(async (error) => {
  // Error messages from drivers may contain connection details. Only print
  // the fixed index remediation text; avoid leaking Atlas credentials.
  if (String(error?.message || "").startsWith("REFUSED: exam attempt indexes")) {
    console.error(error.message);
  } else {
    console.error("Failed to start API. Check MongoDB access and environment configuration.");
  }
  try { await disconnectDB(); } catch { /* Startup already failed. */ }
  process.exitCode = 1;
});
