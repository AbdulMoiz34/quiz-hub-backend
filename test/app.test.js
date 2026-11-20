import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

async function withServer(isDbReady, callback) {
  const app = createApp({
    allowedOrigins: ["http://localhost:5173"],
    jwtSecret: "testing-secret-with-over-32-characters-and-randomness",
    nodeEnv: "test",
    cookieSameSite: "lax",
    isDbReady,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");

  try {
    await callback("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((err) => err ? reject(err) : resolve());
    });
  }
}

test("liveness works without MongoDB", async () => {
  await withServer(() => false, async (base) => {
    const response = await fetch(base + "/api/v1/health");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
  });
});

test("readiness returns 503 when MongoDB is unavailable", async () => {
  await withServer(() => false, async (base) => {
    const response = await fetch(base + "/api/v1/ready");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, "not_ready");
  });
});

test("readiness returns 200 when MongoDB is available", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/ready");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ready");
  });
});

test("unknown API route returns JSON 404", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/unknown");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, message: "Route not found" });
  });
});

test("CORS accepts configured origins", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });
});

test("CORS blocks untrusted origins", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/health", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { success: false, message: "Origin not allowed" });
  });
});

test("malformed JSON receives a 400 response", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/health", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
  });
});
