import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { createApp } from "../src/app.js";
import { Admin } from "../src/modules/admin/admin.model.js";

const origin = "http://localhost:5173";
const secret = "only-for-tests-this-is-32-characters-long-123456789";

async function withServer(fn) {
  const server = createApp({ allowedOrigins: [origin], jwtSecret: secret, isDbReady: () => true })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  try { await fn("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const postHeaders = { Origin: origin, "Content-Type": "application/json" };

test("admin routes reject unauthenticated requests", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/admin/auth/me");
    assert.equal(response.status, 401);
  });
});

test("admin login rejects invalid details before database access", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/admin/auth/login", {
      method: "POST", headers: postHeaders, body: JSON.stringify({ email: "invalid", password: "" }),
    });
    assert.equal(response.status, 400);
  });
});

test("admin mutations reject requests without trusted Origin", async () => {
  await withServer(async (base) => {
    const response = await fetch(base + "/api/v1/admin/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "test-password" }),
    });
    assert.equal(response.status, 403);
  });
});

test("admin can login, read profile, logout, and old cookie becomes invalid", async () => {
  const original = {
    findOne: Admin.findOne,
    findById: Admin.findById,
    updateOne: Admin.updateOne,
  };
  const hash = await bcrypt.hash("a-long-testing-password", 4);
  const id = new mongoose.Types.ObjectId();
  const fakeAdmin = { _id: id, email: "admin@example.com", passwordHash: hash, sessionVersion: 0 };
  Admin.findOne = () => ({ select: async () => fakeAdmin });
  Admin.findById = () => ({ select: async () => fakeAdmin });
  Admin.updateOne = async () => { fakeAdmin.sessionVersion += 1; return { modifiedCount: 1 }; };

  try {
    await withServer(async (base) => {
      const login = await fetch(base + "/api/v1/admin/auth/login", {
        method: "POST", headers: postHeaders,
        body: JSON.stringify({ email: "admin@example.com", password: "a-long-testing-password" }),
      });
      assert.equal(login.status, 200);
      assert.equal((await login.json()).admin.email, "admin@example.com");
      const cookieHeader = login.headers.get("set-cookie");
      assert.ok(cookieHeader.includes("HttpOnly"));
      const cookie = cookieHeader.split(";")[0];

      const me = await fetch(base + "/api/v1/admin/auth/me", { headers: { Cookie: cookie } });
      assert.equal(me.status, 200);
      assert.equal((await me.json()).admin.email, "admin@example.com");

      const logout = await fetch(base + "/api/v1/admin/auth/logout", {
        method: "POST", headers: { Origin: origin, Cookie: cookie },
      });
      assert.equal(logout.status, 200);
      assert.equal(fakeAdmin.sessionVersion, 1);

      const expired = await fetch(base + "/api/v1/admin/auth/me", { headers: { Cookie: cookie } });
      assert.equal(expired.status, 401);
    });
  } finally {
    Object.assign(Admin, original);
  }
});
