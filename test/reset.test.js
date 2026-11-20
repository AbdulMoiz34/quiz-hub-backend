import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Admin } from "../src/models/admin.model.js";
import { Attempt } from "../src/models/attempt.model.js";
import { generateAdminJwt, generateAttemptJwt } from "../src/utils/generateJwt.js";

const origin = "http://localhost:5173";
const secret = "admin-reset-test-secret-longer-than-thirty-two";
const attemptId = new mongoose.Types.ObjectId();
const admin = { _id: new mongoose.Types.ObjectId(), email: "admin@example.com", sessionVersion: 0 };

function query(value) {
  return {
    select() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}
async function withServer(fn) {
  const server = createApp({
    allowedOrigins: [origin], jwtSecret: secret,
    nodeEnv: "test", cookieSameSite: "lax", isDbReady: () => true,
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await fn("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((r) => server.close(r)); }
}

test("admin delete is authenticated, removes one attempt and invalidates its JWT", async () => {
  const originals = {
    adminById: Admin.findById,
    deleteAttempt: Attempt.findByIdAndDelete,
    attemptById: Attempt.findById,
  };
  let exists = true;
  Admin.findById = () => query(admin);
  Attempt.findByIdAndDelete = () => query(exists ? (exists = false, { _id: attemptId }) : null);
  Attempt.findById = () => query(exists ? { _id: attemptId } : null);
  try {
    await withServer(async (base) => {
      const url = base + "/api/v1/admin/attempts/" + attemptId;
      const unauthed = await fetch(url, { method: "DELETE", headers: { Origin: origin } });
      assert.equal(unauthed.status, 401);
      assert.equal(exists, true);

      const auth = {
        Origin: origin, Cookie: "quiz_hub_admin=" + generateAdminJwt(admin, secret),
      };
      const invalid = await fetch(base + "/api/v1/admin/attempts/invalid", {
        method: "DELETE", headers: auth,
      });
      assert.equal(invalid.status, 400);

      const result = await fetch(url, { method: "DELETE", headers: auth });
      assert.equal(result.status, 200);
      assert.equal((await result.json()).data.id, String(attemptId));
      assert.equal(exists, false);

      const second = await fetch(url, { method: "DELETE", headers: auth });
      assert.equal(second.status, 404);

      const current = await fetch(base + "/api/v1/student/attempts/current", {
        headers: { Cookie: "quiz_hub_attempt=" + generateAttemptJwt({ _id: attemptId }, secret) },
      });
      assert.equal(current.status, 401);
    });
  } finally {
    Admin.findById = originals.adminById;
    Attempt.findByIdAndDelete = originals.deleteAttempt;
    Attempt.findById = originals.attemptById;
  }
});
