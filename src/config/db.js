import mongoose from "mongoose";

export async function connectDB(uri) {
  await mongoose.connect(uri, {
    maxPoolSize: 15,
    serverSelectionTimeoutMS: 10_000,
  });
  console.info("MongoDB connected");
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDB() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
