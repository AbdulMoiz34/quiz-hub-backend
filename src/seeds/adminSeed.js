import "dotenv/config";
import bcrypt from "bcryptjs";
import { loadConfig } from "../config/env.js";
import { connectDB, disconnectDB } from "../config/db.js";
import { Admin } from "../models/admin.model.js";

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password || Buffer.byteLength(password, "utf8") < 12 ||
      Buffer.byteLength(password, "utf8") > 72 ||
      email === "admin@example.com" || password.startsWith("REPLACE_")) {
    throw new Error("Set a real ADMIN_EMAIL and strong ADMIN_PASSWORD (12-72 bytes) in .env");
  }

  const config = loadConfig();
  await connectDB(config.mongoUri);
  try {
    await Admin.init();
    if (await Admin.exists({})) {
      console.info("Admin already exists. Nothing changed.");
      return;
    }
    await Admin.create({ email, passwordHash: await bcrypt.hash(password, 12) });
    console.info("Admin seeded successfully:", email);
  } finally {
    await disconnectDB();
  }
}

seedAdmin().catch(() => {
  console.error("Admin seeding failed. Check your .env and MongoDB access.");
  process.exitCode = 1;
});
