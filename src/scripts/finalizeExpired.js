import { loadConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { Attempt } from "../models/attempt.model.js";
import { finalizeExpiredAttempt } from "../utils/finalizeExpiredAttempt.js";

// A one-shot script for a future 1-minute EC2 cron; no background worker,
// Redis or scheduler package required. Safe to run again.
async function main() {
  const config = loadConfig();
  await connectDB(config.mongoUri);

  try {
    const expired = await Attempt.find({
      status: "started",
      expiresAt: { $lte: new Date() },
    }).select("_id").lean();

    let finalized = 0;
    for (const { _id } of expired) {
      const attempt = await finalizeExpiredAttempt(_id);
      if (attempt?.status === "submitted") finalized += 1;
    }
    console.info(`Expired attempts processed: ${finalized}/${expired.length}`);
  } finally {
    await disconnectDB();
  }
}

main().catch(() => {
  // MongoDB errors may include credentials: do not log raw driver exceptions.
  console.error("Failed to finalize expired attempts; retry the command later.");
  process.exitCode = 1;
});
