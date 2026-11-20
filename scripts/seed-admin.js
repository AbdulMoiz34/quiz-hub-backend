import "dotenv/config";
import bcrypt from "bcryptjs";
import Joi from "joi";
import { loadConfig } from "../src/config/env.js";
import { connectDatabase, disconnectDatabase } from "../src/config/db.js";
import { Admin } from "../src/modules/admin/admin.model.js";

const adminSeedSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(12).max(72).required(),
});

async function seedAdmin() {
  const { value, error } = adminSeedSchema.validate({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (error || Buffer.byteLength(value.password, "utf8") > 72 ||
      value.password.startsWith("REPLACE_") || value.email === "admin@example.com") {
    throw new Error("Set ADMIN_EMAIL and ADMIN_PASSWORD (12-72 bytes) in your private .env file");
  }

  const config = loadConfig();
  await connectDatabase(config.mongoUri);
  await Admin.init();

  const existing = await Admin.exists({});
  if (existing) {
    console.log("Admin already exists. Seed skipped; existing password was not changed.");
    return;
  }

  await Admin.create({
    email: value.email.toLowerCase(),
    passwordHash: await bcrypt.hash(value.password, 12),
  });
  console.log("Admin created successfully:", value.email.toLowerCase());
}

try {
  await seedAdmin();
} catch (error) {
  if (error?.message?.startsWith("Set ADMIN_EMAIL")) console.error(error.message);
  else console.error("Admin seed failed. Verify MongoDB access and environment configuration.");
  process.exitCode = 1;
} finally {
  try { await disconnectDatabase(); } catch { process.exitCode = 1; }
}
