import "dotenv/config";
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import { loadConfig } from "../config/env.js";

// Read-only preview: npm run db:migrate:check
// Explicit application after a verified backup and legacy exam completion:
// npm run db:migrate -- --expect-db=the_exact_database_name
const obsoleteKeys = new Set([
  JSON.stringify({ quiz: 1, rollNo: 1 }),
  JSON.stringify({ slot: 1, seatNumber: 1 }),
  JSON.stringify({ slot: 1, status: 1 }),
  JSON.stringify({ quiz: 1, slot: 1, _id: -1 }),
]);
const emailKey = JSON.stringify({ quiz: 1, email: 1 });
const emailFilter = JSON.stringify({ email: { $type: "string" } });

function isReady(index) {
  return JSON.stringify(index.key) === emailKey &&
    index.unique === true &&
    JSON.stringify(index.partialFilterExpression) === emailFilter;
}

async function main() {
  const check = process.argv.includes("--check");
  const apply = process.argv.includes("--apply");
  if (check === apply) {
    throw new Error("Specify exactly one mode: --check or --apply");
  }
  const expectedDb = process.argv.find((arg) => arg.startsWith("--expect-db="))?.slice(12);
  if (apply && !expectedDb) {
    throw new Error("Apply requires --expect-db=the_exact_database_name");
  }

  const config = loadConfig();
  await connectDB(config.mongoUri);
  const db = mongoose.connection.db;
  // Refuse BEFORE creating or dropping any index.
  if (apply && db.databaseName !== expectedDb) {
    throw new Error("REFUSED: database name differs from --expect-db");
  }

  const exists = await db.listCollections({ name: "attempts" }, { nameOnly: true }).hasNext();
  const collection = db.collection("attempts");
  const indexes = exists ? await collection.indexes() : [];
  const oldIndexes = indexes.filter((index) =>
    obsoleteKeys.has(JSON.stringify(index.key))
  );
  const activeLegacy = exists ? await collection.countDocuments({
    email: { $exists: false },
    status: "started",
    expiresAt: { $gt: new Date() },
  }) : 0;

  console.info(JSON.stringify({
    mode: apply ? "apply" : "read-only check",
    database: db.databaseName,
    activeLegacyAttempts: activeLegacy,
    emailUniqueIndexReady: indexes.some(isReady),
    obsoleteIndexNames: oldIndexes.map((index) => index.name),
  }, null, 2));

  if (check) {
    console.info("Read-only check complete. No database changes made.");
    return;
  }
  if (activeLegacy > 0) {
    throw new Error("REFUSED: active legacy attempts must finish before migration");
  }

  // Build the replacement constraint before removing the old unique index.
  await collection.createIndex({ quiz: 1, email: 1 }, {
    name: "quiz_1_email_1",
    unique: true,
    partialFilterExpression: { email: { $type: "string" } },
  });
  const afterCreate = await collection.indexes();
  if (!afterCreate.some(isReady)) {
    throw new Error("REFUSED: email uniqueness index was not verified");
  }

  for (const index of afterCreate) {
    if (obsoleteKeys.has(JSON.stringify(index.key))) {
      await collection.dropIndex(index.name);
      console.info("Dropped obsolete index: " + index.name);
    }
  }

  const finalIndexes = await collection.indexes();
  if (!finalIndexes.some(isReady) ||
      finalIndexes.some((index) => obsoleteKeys.has(JSON.stringify(index.key)))) {
    throw new Error("Migration verification failed; inspect database indexes");
  }
  console.info("Migration verified; historical attempts and old slots untouched.");
}

try {
  await main();
} catch (error) {
  // Only display known safety errors. Driver messages might contain credentials.
  const reason = String(error?.message || "");
  if (reason.startsWith("REFUSED:") ||
      reason.startsWith("Specify exactly one mode") ||
      reason.startsWith("Apply requires")) {
    console.error(reason);
  } else {
    console.error("Migration failed. Inspect configuration, active attempts and index state.");
  }
  process.exitCode = 1;
} finally {
  try { await disconnectDB(); } catch { process.exitCode = 1; }
}
