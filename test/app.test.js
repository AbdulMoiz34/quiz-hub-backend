import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "../src/app.js";

async function withServer(isDbReady, callback) {
  const app = createApp({
    allowedOrigins: ["http://localhost:5173"],
    jwtSecret: "only-for-tests-this-is-32-characters-long-123456789",
    isDbReady,
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    return await callback("http://127.0.0.1:" + server.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("liveness does not depend on MongoDB connectivity", async () => {
  await withServer(() => false, async (base) => {
    const response = await fetch(base + "/api/v1/health");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ok");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("readiness returns 503 when MongoDB is disconnected", async () => {
  await withServer(() => false, async (base) => {
    const response = await fetch(base + "/api/v1/ready");
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, "not_ready");
  });
});

test("readiness returns 200 when MongoDB is connected", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/ready");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "ready");
  });
});

test("unknown route returns a JSON 404", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/unknown");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, message: "Route not found" });
  });
});

test("CORS allows the configured browser origin", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/health", {
      headers: { Origin: "http://localhost:5173" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  });
});

test("CORS blocks unconfigured browser origins", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/health", {
      headers: { Origin: "https://untrusted.example" },
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Origin not allowed");
  });
});

test("malformed JSON receives 400 without a stack trace", async () => {
  await withServer(() => true, async (base) => {
    const response = await fetch(base + "/api/v1/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{broken",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { success: false, message: "Invalid JSON body" });
  });
});
