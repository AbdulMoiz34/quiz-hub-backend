import "dotenv/config";
import { loadConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { Attempt } from "../models/attempt.model.js";

// One-time, explicit index migration. Keeps all historical Attempt records.
// Run after backup and before deploying the email-based API version.
// Do NOT run old and new backend versions simultaneously.
async function main() {
  const config = loadConfig();
  await connectDB(config.mongoUri);
  try {
    const collection = Attempt.collection;
    const existing = await collection.indexes();
    const obsolete = new Set([
      "quiz_1_rollNo_1",
      "slot_1_seatNumber_1",
      "slot_1_status_1",
      "quiz_1_slot_1__id_-1",
    ]);
    for (const index of existing) {
      if (!obsolete.has(index.name)) continue;
      await collection.dropIndex(index.name);
      console.info("Removed obsolete index:", index.name);
    }
    await Attempt.createIndexes();
    console.info("Email attempt index ready. No attempt documents deleted.");
  } finally {
    await disconnectDB();
  }
}
main().catch(() => {
  console.error("Attempt index migration failed. Verify backup and database permissions.");
  process.exitCode = 1;
});
