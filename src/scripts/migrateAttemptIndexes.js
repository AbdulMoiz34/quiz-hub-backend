import "dotenv/config";
import { connectDB, disconnectDB } from "../config/db.js";
import { loadConfig } from "../config/env.js";
import mongoose from "mongoose";

// Run once during maintenance BEFORE deploying the email-only API.
// Leaves historical attempts and the old slots collection untouched.
async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("Use npm run db:migrate to explicitly apply this index migration");
  }
  const config = loadConfig();
  await connectDB(config.mongoUri);
  const collection = mongoose.connection.db.collection("attempts");

  // Old active attempts have no email; they must finish before deployment.
  const activeLegacy = await collection.findOne({
    email: { $exists: false }, status: "started", expiresAt: { $gt: new Date() },
  }, { projection: { _id: 1 } });
  if (activeLegacy) throw new Error("Active legacy attempts exist; run migration after they finish");

  // Create the new constraint before removing old uniqueness protection.
  await collection.createIndex({ quiz: 1, email: 1 }, {
    name: "quiz_1_email_1",
    unique: true,
    partialFilterExpression: { email: { $type: "string" } },
  });
  const indexes = await collection.indexes();
  for (const index of indexes) {
    const key = JSON.stringify(index.key);
    if (key === '{"quiz":1,"rollNo":1}' ||
        key === '{"slot":1,"seatNumber":1}' ||
        key === '{"slot":1,"status":1}' ||
        key === '{"quiz":1,"slot":1,"_id":-1}') {
      await collection.dropIndex(index.name);
      console.info("Dropped obsolete index: " + index.name);
    }
  }
  console.info("Email uniqueness index ready; old attempt documents preserved");
}

try {
  await main();
} catch {
  // Do not log driver errors that may contain connection credentials.
  console.error("Attempt index migration failed. Check database access and active old attempts.");
  process.exitCode = 1;
} finally {
  try { await disconnectDB(); } catch { process.exitCode = 1; }
}
