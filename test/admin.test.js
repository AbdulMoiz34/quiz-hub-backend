import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Admin } from "../src/models/admin.model.js";

const origin = "http://localhost:5173";
const jwtSecret = "testing-secret-with-over-32-characters-and-randomness";

async function withServer(run) {
  const app = createApp({
    allowedOrigins: [origin], jwtSecret, nodeEnv: "test", cookieSameSite: "lax",
    isDbReady: () => true,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await run("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const headers = { Origin: origin, "Content-Type": "application/json" };

test("admin /me requires a valid session", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/admin/auth/me");
    assert.equal(response.status, 401);
  });
});

test("login validates input before database access", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/admin/auth/login", {
      method: "POST", headers, body: JSON.stringify({ email: "invalid", password: "" }),
    });
    assert.equal(response.status, 400);
  });
});

test("admin write endpoints require allowed Origin", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/admin/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "secret" }),
    });
    assert.equal(response.status, 403);
  });
});

test("login and logout invalidate previous admin cookie", async () => {
  const originals = {
    findOne: Admin.findOne,
    findById: Admin.findById,
    updateOne: Admin.updateOne,
  };
  const admin = {
    _id: new mongoose.Types.ObjectId(),
    email: "admin@example.com",
    passwordHash: await bcrypt.hash("strong-testing-password", 4),
    sessionVersion: 0,
  };
  Admin.findOne = () => ({ select: async () => admin });
  Admin.findById = () => ({ select: async () => admin });
  Admin.updateOne = async () => { admin.sessionVersion += 1; return { modifiedCount: 1 }; };

  try {
    await withServer(async (base) => {
      const login = await fetch(base + "/api/v1/admin/auth/login", {
        method: "POST", headers,
        body: JSON.stringify({ email: "admin@example.com", password: "strong-testing-password" }),
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).data.email, "admin@example.com");
      const cookieHeader = login.headers.get("set-cookie");
      assert.match(cookieHeader, /HttpOnly/);
      const cookie = cookieHeader.split(";")[0];

      const me = await fetch(base + "/api/v1/admin/auth/me", {
        headers: { Cookie: cookie },
      });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).data.email, "admin@example.com");

      const logout = await fetch(base + "/api/v1/admin/auth/logout", {
        method: "POST", headers: { Origin: origin, Cookie: cookie },
      });
      assert.equal(logout.status, 200);
      assert.equal(admin.sessionVersion, 1);

      const after = await fetch(base + "/api/v1/admin/auth/me", {
        headers: { Cookie: cookie },
      });
      assert.equal(after.status, 401);
    });
  } finally {
    Object.assign(Admin, originals);
  }
});
