import { loadConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import mongoose from "mongoose";

try {
  const config = loadConfig();
  await connectDB(config.mongoUri);
  await mongoose.connection.db.admin().ping();
  console.info("MongoDB ping successful, database:", mongoose.connection.db.databaseName);
} catch {
  console.error("MongoDB connection failed. Check password encoding, URI and Atlas IP allowlist.");
  process.exitCode = 1;
} finally {
  await disconnectDB();
}
