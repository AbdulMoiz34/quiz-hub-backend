import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config/env.js";

const valid = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/quiz_hub",
  CORS_ORIGINS: "http://localhost:5173,https://quiz.example.com",
  JWT_SECRET: "testing-secret-with-over-32-characters-and-randomness",
};

test("environment defaults stay simple", () => {
  const config = loadConfig(valid);
  assert.equal(config.port, 5000);
  assert.equal(config.host, "127.0.0.1");
  assert.deepEqual(config.allowedOrigins, ["http://localhost:5173", "https://quiz.example.com"]);
  assert.equal(config.cookieSameSite, "lax");
});

test("missing database URI rejected", () => {
  assert.throws(() => loadConfig({ ...valid, MONGODB_URI: "" }), /MONGODB_URI/);
});

test("weak secret rejected", () => {
  assert.throws(() => loadConfig({ ...valid, JWT_SECRET: "short" }), /JWT_SECRET/);
});

test("wildcard and origin paths rejected", () => {
  assert.throws(() => loadConfig({ ...valid, CORS_ORIGINS: "*" }), /CORS_ORIGINS/);
  assert.throws(() => loadConfig({ ...valid, CORS_ORIGINS: "http://localhost:5173/" }), /origins only/);
});

test("production requires HTTPS origins", () => {
  assert.throws(() => loadConfig({ ...valid, NODE_ENV: "production" }), /HTTPS/);
});

test("SameSite=None requires production HTTPS", () => {
  assert.throws(() => loadConfig({ ...valid, COOKIE_SAME_SITE: "none" }), /HTTPS/);
});
