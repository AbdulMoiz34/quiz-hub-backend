import mongoose from "mongoose";

export async function connectDatabase(uri) {
  await mongoose.connect(uri, {
    maxPoolSize: 15,
    serverSelectionTimeoutMS: 10000,
  });
}

export function isDatabaseReady() {
  return mongoose.connection.readyState === 1;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
