import { loadConfig } from "../src/config/env.js";
import { connectDatabase, disconnectDatabase } from "../src/config/db.js";
import mongoose from "mongoose";

try {
  const config = loadConfig();
  await connectDatabase(config.mongoUri);
  await mongoose.connection.db.admin().ping();
  console.log("MongoDB connection successful. Database:", mongoose.connection.db.databaseName);
} catch {
  // Avoid printing connection strings or credentials contained in driver errors.
  console.error("MongoDB connection failed. Check URI, password encoding and Atlas IP allowlist.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
