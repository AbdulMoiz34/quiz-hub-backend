import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config/env.js";

const valid = {
  MONGODB_URI: "mongodb://127.0.0.1:27017/quiz_hub",
  CORS_ORIGINS: "http://localhost:5173,https://quiz.example.com",
};

test("environment configuration is normalized", () => {
  const config = loadConfig(valid);
  assert.equal(config.port, 5000);
  assert.equal(config.host, "127.0.0.1");
  assert.deepEqual(config.allowedOrigins, ["http://localhost:5173", "https://quiz.example.com"]);
});

test("configuration rejects missing MongoDB URI without leaking credentials", () => {
  assert.throws(() => loadConfig({ CORS_ORIGINS: valid.CORS_ORIGINS }), /MONGODB_URI/);
});

test("configuration rejects wildcard and trailing slash origins", () => {
  assert.throws(() => loadConfig({ ...valid, CORS_ORIGINS: "*" }), /explicit origins/);
  assert.throws(() => loadConfig({ ...valid, CORS_ORIGINS: "http:\/\/localhost:5173\/" }), /origins only/);
});

test("production only allows https origins", () => {
  assert.throws(() => loadConfig({ ...valid, NODE_ENV: "production" }), /https/);
});
